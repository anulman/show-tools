"""Continuous nominal envelope check; not actual spindle fit or service admission."""
from __future__ import annotations
import argparse,json,math
from copy import deepcopy
from pathlib import Path
import panel_mount_box_concept as box
from build123d import Axis,import_step
from OCP.BRepExtrema import BRepExtrema_DistShapeShape


def read(path):return json.loads(path.read_bytes())


def check(base_receipt,grip_receipt,key_receipt,output):
    g=box.g;p=box.previous.inherited
    base=read(base_receipt);grip=read(grip_receipt);keys=read(key_receipt)
    inputs={str(q.resolve()):box.digest(q) for q in (base_receipt,grip_receipt,key_receipt,Path(__file__))}
    thickness=2.38125;exposure=22.;root=thickness+exposure
    measured=base.get('reported_measurements',{});parameters=grip['exploratory_parameters']
    g.audit.require(measured.get('fixed_flange_axial_thickness_mm')==thickness
        and measured.get('visible_knob_underside_to_flange_top_gap_mm')==0.,
        'Wrong box datum:3/32in is fixed flange thickness, not a knob gap')
    g.audit.require(parameters.get('operator_reported_approx_fixed_flange_axial_thickness_mm')==thickness
        and parameters.get('operator_reported_no_visible_gap_above_flange') is True
        and parameters.get('nominal_knob_underside_to_fixed_flange_top_gap_mm')==0.,
        'Wrong grip datum: fixed flange thickness and zero visible gap must be explicit')
    g.audit.require(parameters['exposure_below_original_root_mm']==exposure
        and parameters['nominal_source_to_world']==dict(rotate_x_deg=180.,translate_z_mm=root),
        'Wrong corrected E22 source-to-world placement')
    g.audit.require(keys.get('source_concept_sha256')==box.digest(grip_receipt)
        and keys.get('source_to_world_nominal')==dict(rotate_x_deg=180.,translate_z_mm=root)
        and keys.get('operator_approx_fixed_flange_thickness_mm')==thickness
        and keys.get('no_visible_gap_above_flange') is True,
        'Side-key evidence must bind the corrected grip and flange-thickness datum')
    def load(record):
        for kind,sha_key in (('step','step_sha256'),('stl','stl_sha256')):
            if kind not in record:continue
            path=Path(record[kind]);expected=record.get(sha_key,record.get('sha256'))
            assert box.digest(path)==expected;inputs[str(path.resolve())]=expected
        shape=import_step(record['step']).solids()[0]
        assert shape.is_valid and len(shape.solids())==1
        return shape
    fixed={r['name']:load(r) for r in base['preview_components']}
    source={r['name']:load(r) for r in grip['components']};assert len(source)==9
    assert set(fixed)=={'shell','bottom'}
    assert grip['printed_physical_count']==3 and sum(r['role']=='print' for r in grip['components'])==3
    before={name:p.fingerprint(shape) for name,shape in {**fixed,**source}.items()}
    posed={name:shape.rotate(Axis.X,180).translate((0,0,root)) for name,shape in source.items()}
    # Conservative stationary radial envelopes. Body depth is not a measured
    # physical length and is not checked against the box or bottom here.
    fixed['nominal fixed flange envelope']=g.cad.cyl(17,thickness,0)
    fixed['nominal body radial envelope below roof']=g.cad.cyl(14,200,-200)
    cover=g.compact.build()['covers']['pairs']
    fixed.update({'cover-'+str(i):shape for i,shape in enumerate(g.r.joint_hardware(cover))})
    radius=max(math.hypot(max(abs(s.bounding_box().min.X),abs(s.bounding_box().max.X)),
                          max(abs(s.bounding_box().min.Y),abs(s.bounding_box().max.Y))) for s in posed.values())+1
    high=max(s.bounding_box().max.Z for s in posed.values())+1
    rotor_window=g.cad.ring(21.5,radius,exposure,thickness)+g.cad.cyl(radius,high-root,root)
    key_rows=[row for row in keys['evidence'] if row['id'] in {'-1 whole side key','+1 whole side key'}]
    assert len(key_rows)==2 and {q['id'] for q in key_rows}=={'-1 whole side key','+1 whole side key'}
    tool_records=[r for row in key_rows for r in row['components']]
    tools={r['name']:load(r).rotate(Axis.X,180).translate((0,0,root)) for r in tool_records}
    assert tools
    tool_radius=max(120.,max(math.hypot(max(abs(s.bounding_box().min.X),abs(s.bounding_box().max.X)),
                          max(abs(s.bounding_box().min.Y),abs(s.bounding_box().max.Y))) for s in tools.values())+1)
    low=min(s.bounding_box().min.Z for s in tools.values())-1
    high=max(s.bounding_box().max.Z for s in tools.values())+1
    cutoff=thickness+.5
    tool_window=g.cad.ring(110,tool_radius,cutoff-low,low)+g.cad.cyl(tool_radius,high-cutoff,cutoff)
    def certify(window,subjects):
        rows=[];distances=[]
        for name,shape in subjects.items():
            residual=g.outside_volume(shape,window)
            assert residual<1e-6,(name,residual)
            rows.append(dict(name=name,outside_continuous_window_mm3=residual))
        for name,shape in fixed.items():
            overlap=g.intersection(window,shape);assert overlap<1e-6,(name,overlap)
            d=BRepExtrema_DistShapeShape(deepcopy(window).wrapped,deepcopy(shape).wrapped);d.Perform()
            assert d.IsDone() and math.isfinite(d.Value()) and d.Value()>1e-7,(name,d.Value())
            distances.append(dict(name=name,minimum_window_distance_mm=d.Value()))
        return dict(subjects=rows,fixed_geometry=distances,
                    minimum_nominal_all_angle_clearance_mm=min(r['minimum_window_distance_mm'] for r in distances),
                    angular_samples_used=0,continuous_axisymmetric_containment=True)
    with p.detached_booleans():
        left=source['-1 retained padded shoe'];right=source['+1 retained padded shoe'].rotate(Axis.Z,180)
        shoe_differences=[g.outside_volume(left,right),g.outside_volume(right,left)]
        assert all(v<1e-6 for v in shoe_differences)
        rotor_result=certify(rotor_window,posed)
        tool_result=certify(tool_window,tools)
    for name,shape in {**{n:fixed[n] for n in ('shell','bottom')},**source}.items():
        assert p.fingerprint(shape)==before[name],name
    for path,sha in inputs.items():assert box.digest(Path(path))==sha,path
    report=dict(scope='NOMINAL_PANEL_BASE_AND_INTEGRAL_GRIP_ALL_ANGLE_ENVELOPES_ONLY',
        input_files=inputs,corrected_interface=dict(fixed_flange_thickness_approx_mm=thickness,visible_gap_above_fixed_flange_mm=0.,
            roof_and_flange_bottom_z_mm=0.,flange_top_and_knob_underside_z_mm=thickness,
            bar_original_root_z_mm=root,exposed_grip_end_z_mm=thickness),
        rotor=rotor_result,side_key_bounds=tool_result,actual_subjects_unchanged=True,
        printed_physical_count=5,stationary_print_count=2,rotating_print_count=3,
        identical_shoes_after_Z180_material_differences_mm3=shoe_differences,
        key_receipt_used_only_for_source_frame_tool_geometry=True,
        physical_fit_verified=False,actual_spinner_nut_tool_verified=False,lifecycle_verified=False,
        strength_verified=False,manufacturing_approved=False,
        limitations=['Nominal drawing body28/flange34 only; actual shaft, flange and nut profiles unmeasured',
            'Body radial envelope depth is conservative, not actual length or an interior fit check',
            'Source side-key bounds are checked against the base/envelopes only; intrinsic updated grip proof is separate',
            'No actual knob mesh or zero-gap contact model is invented; device internal rotation is outside this check'])
    assert not output.exists();output.write_text(json.dumps(report,indent=2)+'\n')
    print(output,flush=True);print('rotor nominal bound',rotor_result['minimum_nominal_all_angle_clearance_mm'],flush=True)
    print('side-key nominal bound',tool_result['minimum_nominal_all_angle_clearance_mm'],flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('base-receipt','grip-receipt','key-receipt','output'):parser.add_argument('--'+name,type=Path,required=True)
    a=parser.parse_args();check(a.base_receipt,a.grip_receipt,a.key_receipt,a.output)
