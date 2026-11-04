"""Opt-in, pinned box ledge ramps; issued producers and inputs stay immutable.

Shells are studied roof-down. Ramps support external free ends only; the closed
cable-tie tunnel and its complete loop remain explicit keepouts. This is not a
claim that the complete box can be printed without supports.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
from dataclasses import replace
import json
import math
from pathlib import Path
import sys
import zipfile

from build123d import Axis, Face, Wire, GeomType, import_step, export_stl
import arcade_bottom_chamfer as io
import resin_retention as r
import clean_c_base_admission as native
import c_panel_service_mount as service

PINNED = {
    'arcade': ('/private/tmp/arcade-bottom-chamfer-step-20261103-v2/receipt.json',
               'dca65e1eeb106b28c7a1d58c38229cbcfbd84eb3a1cef520ca4bde5a616cf2fa'),
    'disco': ('/private/tmp/panel-mount-low-box-concept-v3/preview-receipt.json',
              '4724a40a8c5b8873fcf6745380bb7f6477a057cc4a8613a9a8e03c81fafd1327'),
}
TOL = 1e-6


def require(value, message):
    io.require(value, message)


def common(first, second):
    return deepcopy(first) & deepcopy(second)


def union(parts):
    result = deepcopy(parts[0])
    for part in parts[1:]:
        result = result + deepcopy(part)
    return result


def volume(shape):
    return io.adaptive_mass(shape)[0]


def load(kind):
    path, expected = PINNED[kind]
    path = Path(path)
    require(io.digest(path) == expected, 'Wrong pinned source receipt')
    report = json.loads(path.read_text())
    records = report['review_components' if kind == 'arcade' else 'preview_components']
    parts, inputs = {}, {str(path): expected}
    for record in records:
        name = record['name']; step = Path(record['step'])
        digest = record['step_sha256' if kind == 'arcade' else 'sha256']
        require(io.digest(step) == digest, 'Changed source STEP')
        inputs[str(step)] = digest
        shape = import_step(step)
        require(shape.is_valid and len(shape.solids()) == 1, 'Invalid source part')
        shift = tuple(-v for v in record['source_to_print_translation_mm']) if kind == 'arcade' else (0, 0, 0)
        parts[name] = shape.solids()[0].translate(shift)
    require(set(parts) == {'shell', 'bottom'}, 'Wrong source inventory')
    return parts, inputs


def prism(points, direction, length):
    face = Face(Wire.make_polygon(points, close=True))
    return r.extrude(face, amount=length, dir=direction)


def tie_witnesses(floor, rear=False):
    """Same full-loop, head, tail and bundle envelopes as the issued producers."""
    result = []
    for diameter in (3., 8.):
        low = 1.35; high = diameter + 4.45; height = high - low
        outer = r.Plane.XZ * r.RectangleRounded(33.2, height, 1.5)
        inner = r.Plane.XZ * r.RectangleRounded(30.6, height - 2.6, .2)
        loop = r.extrude(outer-inner, amount=1.25, both=True).translate((0, -38, floor+(low+high)/2))
        head = r.block(4.8, 4.7, 3.7, (-18.5, -38, floor+1.25))
        bundle = r.cad.cyl(diameter/2, 48 if rear else 12, -24 if rear else -6).rotate(Axis.X, 90)
        bundle = bundle.translate((0, -38, floor+3+diameter/2))
        if rear:
            # Issued compact rear witness: loop y55, straight bundle y43.
            loop = loop.rotate(Axis.Z, 180).translate((0, 17, 0))
            head = head.rotate(Axis.Z, 180).translate((0, 17, 0))
            bundle = r.cad.cyl(diameter/2, 48, -24).rotate(Axis.X, 90).translate((0, 43, floor+3+diameter/2))
        result.extend([(f'loop-{diameter}', loop), (f'head-{diameter}', head), (f'bundle-{diameter}', bundle)])
    for x in (-11, 11):
        tail = r.block(8.1, 2.5, 1.3, (x, -38, floor+1.35))
        tunnel = r.block(8.2, 3.2, 1.8, (x, -38, floor+1.2))
        if rear:
            tail = tail.rotate(Axis.Z, 180).translate((0, 17, 0))
            tunnel = tunnel.rotate(Axis.Z, 180).translate((0, 17, 0))
        result.extend([(f'tail-{x}', tail), (f'tunnel-{x}', tunnel)])
    return result


def build(kind):
    source, inputs = load(kind)
    floor = -65. if kind == 'arcade' else -61.
    y_axis = 54. if kind == 'arcade' else 49.
    tilt = 5. if kind == 'arcade' else 0.
    factor = 1.2 if tilt else 1.
    witnesses = [('front-'+name, shape) for name, shape in tie_witnesses(floor)]
    if kind == 'arcade':
        witnesses += [('rear-'+name, shape) for name, shape in tie_witnesses(floor+24, True)]
    raw, features = [], []
    for x in (-49., 49.):
        for y in (-y_axis, y_axis):
            sign = math.copysign(1, x); start = sign*43.; wall = sign*53.2
            z = floor+12.; height = 10.2*factor
            ramp = prism([(start, y-6, z), (wall, y-6, z), (wall, y-6, z+height)], (0, 1, 0), 12)
            # Keep the original coaxial hole open through all added material.
            ramp = ramp - r.bore(x, y, floor, floor+40)
            raw.append(ramp)
            features.append(dict(name=f'nut-seat-{x}-{y}', kind='nut-seat', axis_xy_mm=[x,y],
                                 original_free_end_z_mm=z, wall_x_mm=wall,
                                 slope_rise_mm=height, slope_run_mm=10.2))
    eye_floor = floor+24 if kind == 'arcade' else floor
    wall_y = 58.2 if kind == 'arcade' else -53.2
    tip_y = 51. if kind == 'arcade' else -34.
    for x in (-11., 11.):
        z = eye_floor+5.6; run = abs(wall_y-tip_y); height = run*factor
        ramp = prism([(x-4,tip_y,z),(x-4,wall_y,z),(x-4,wall_y,z+height)], (1,0,0), 8)
        raw.append(ramp)
        features.append(dict(name=f'wall-tie-eye-{x}', kind='tie-eye', centre_x_mm=x,
                             original_free_end_z_mm=z, wall_y_mm=wall_y,
                             slope_rise_mm=height,slope_run_mm=run))
    ramps = union(raw)
    before_keepouts = deepcopy(ramps)
    for _, witness in witnesses:
        ramps = ramps-deepcopy(witness)
    shell = deepcopy(source['shell'])+deepcopy(ramps)
    return dict(kind=kind, source=source, parts=dict(shell=shell,bottom=deepcopy(source['bottom'])),
                floor=floor, y_axis=y_axis, tilt=tilt, witnesses=witnesses, ramps=ramps,
                raw_ramps=before_keepouts, features=features, inputs=inputs,
                fingerprints={n:native.fingerprint(s) for n,s in source.items()})


def flat_free_ends(data, shape):
    rows=[]
    for feature in data['features']:
        z=feature['original_free_end_z_mm']; faces=[]
        for face in shape.faces():
            if face.geom_type!=GeomType.PLANE or face.normal_at().Z<.999:continue
            b=face.bounding_box(); c=face.center()
            if abs(b.min.Z-z)>TOL or abs(b.max.Z-z)>TOL:continue
            if feature['kind']=='nut-seat':
                x,y=feature['axis_xy_mm']
                match=abs(c.X-x)<7 and abs(c.Y-y)<7
            else:
                match=abs(c.X-feature['centre_x_mm'])<4.1 and min(feature['wall_y_mm'], -34 if data['kind']=='disco' else 51)-.1<=c.Y<=max(feature['wall_y_mm'], -34 if data['kind']=='disco' else 51)+.1
            if match:
                faces.append(dict(area_mm2=face.area,span_xy_mm=[b.size.X,b.size.Y]))
        rows.append(dict(name=feature['name'],flat_faces=faces,flat_area_mm2=sum(f['area_mm2'] for f in faces)))
    return rows


def ledge_gate(rows):
    for row in rows:
        require(row['flat_area_mm2']<TOL, 'Unsupported original external free end: '+row['name'])


def ledge_evidence(data):
    baseline=flat_free_ends(data,data['source']['shell'])
    candidate=flat_free_ends(data,data['parts']['shell'])
    rejected=[]
    for row in baseline:
        try:ledge_gate([row])
        except ValueError:rejected.append(row['name'])
    require(len(rejected)==6, 'Baseline did not expose all six flat external free ends')
    ledge_gate(candidate)
    # Only new horizontal faces are the swept tie-loop passage floors. Their
    # unsupported direction is along Y, between the existing loop side planes.
    bridges=[]
    eye_z=data['floor']+(24 if data['kind']=='arcade' else 0)+5.6
    for face in data['parts']['shell'].faces():
        if face.geom_type!=GeomType.PLANE or face.normal_at().Z<.999:continue
        b=face.bounding_box(); c=face.center()
        if b.min.Z<eye_z+TOL or b.max.Z>=-20:continue
        if not (7-TOL<=abs(c.X)<=15+TOL):continue
        if not (51<=c.Y<=58.2 if data['kind']=='arcade' else -53.2<=c.Y<=-34):continue
        require(b.size.Y<=3.2+TOL,'New residual ledge exceeds the original 3.2 mm tie tunnel span')
        bridges.append(dict(bounds_mm=[list(b.min),list(b.max)],unsupported_span_y_mm=b.size.Y,
                            cross_span_width_x_mm=b.size.X,area_mm2=face.area,
                            cause='Complete tie-loop keepout interrupts external ramp'))
    require(bool(bridges),'Expected explicit tie-loop bridge exceptions')
    return dict(baseline_flat_free_ends=baseline,baseline_gate_rejected_features=rejected,
                candidate_original_free_ends=candidate,candidate_free_end_gate_pass=True,
                new_flat_bridge_exceptions=bridges,
                maximum_new_bridge_span_mm=max(row['unsupported_span_y_mm'] for row in bridges),
                inherited_tie_tunnel_span_mm=3.2,
                inherited_other_surfaces_not_admitted_as_support_free=True)


def validate(data):
    kind=data['kind']; parts=data['parts']; source=data['source']; floor=data['floor']
    for name,shape in parts.items():
        require(shape.is_valid and len(shape.solids())==1, 'Invalid candidate '+name)
    io.equal(parts['bottom'],source['bottom'],'Bottom changed')
    require(io.boolean(source['shell'],parts['shell'],'cut')<TOL,'Original shell material removed')
    added=deepcopy(parts['shell'])-deepcopy(source['shell'])
    added_volume=volume(added)
    require(added_volume>10,'No effective ramp addition')
    require(io.boolean(added,data['ramps'],'cut')<TOL,'Changes escaped named ramps')
    require(io.boolean(parts['shell'],parts['bottom'],'common')<TOL,'Shell/bottom interference')
    upper=r.block(400,400,200,(0,0,-20))
    io.equal(common(parts['shell'],upper),common(source['shell'],upper),'Roof/upper interface changed')
    centre=r.cad.cyl(25,200,-150)
    io.equal(common(parts['shell'],centre),common(source['shell'],centre),'Central device/tool reserve changed')
    # Added ramps begin at each tower free end; the complete nut/bearing body
    # below it must remain exactly equal, including the hex pocket voids.
    joint_rows=[]; joints=[]
    for x in (-49.,49.):
        for y in (-data['y_axis'],data['y_axis']):
            region=r.cad.cyl(6.1,12,floor).translate((x,y,0))
            io.equal(common(parts['shell'],region),common(source['shell'],region),'Nut seat or pocket changed')
            io.require(io.boolean(r.bore(x,y,floor,floor+40),parts['shell'],'common')<TOL,'Extended cover bore blocked')
            joint=r.make_joint(f'cover-{x}-{y}',(x,y),floor-3+1.85,10,floor+2.2,1)
            joints.append(joint)
    with native.detached_booleans():
        body=union(list(parts.values()))
        reactions=r.check_joints(joints,body)
        loading=r.verify_nut_loading(joints,parts['shell'])
        for joint in joints:
            for name,part in parts.items():
                require(io.boolean(service.screw_sweep(joint,14),part,'common')<TOL,'Screw withdrawal blocked')
                for phase,bound in service.key2_bounds(joint).items():
                    require(io.boolean(bound,part,'common')<TOL,'AF2 '+phase+' blocked')
            for length in (9.71,10.29):
                r.check_joint(replace(joint,length=length,screw=r.bolt(*joint.expected_xy,joint.length_datum_z,length,1)),body)
            joint_rows.append(dict(axis_xy_mm=list(joint.expected_xy),M3_under_head_length_mm=10,
                                   length_endpoints_mm=[9.71,10.29],whole_AF2_and_withdrawal_clear=True))
    for label,witness in data['witnesses']:
        # A tunnel tool can extend slightly outside its own eye; source itself
        # must already be clear before this candidate can inherit its path.
        require(io.boolean(witness,source['shell'],'common')<TOL,'Source path blocked: '+label)
        for name,part in parts.items():
            require(io.boolean(witness,part,'common')<TOL,'Candidate path blocked: '+label+'/'+name)
    # Continuous 100 mm withdrawal of the unchanged cover. Detach every face
    # before intersect/extrude, as OCCT operations may mutate shared topology.
    removal=deepcopy(parts['bottom'])
    for face in parts['bottom'].faces():
        if face.normal_at().Z>.9:
            removal=removal+r.extrude(deepcopy(face),amount=-100,dir=(0,0,1))
    require(io.boolean(removal,parts['shell'],'common')<TOL,'Continuous cover withdrawal blocked')
    if kind=='arcade':
        # The confirmed axial reserve is centered on the tilted button axis.
        # Its radius is read from the original pinned manufacturer's box params.
        params=r.cad.box_cad.Proposal()
        require(params.clearance_mm==63.5 and params.corridor_radius==13.5,'Arcade reserve definition changed')
        corridor=r.cad.cyl(params.corridor_radius,63.5,-63.5).rotate(Axis.X,5)
        for shape in parts.values():
            require(io.boolean(corridor,shape,'common')<TOL,'63.5 mm button reserve blocked')
    slope_faces=[]
    for face in added.faces():
        if face.geom_type != GeomType.PLANE:continue
        n=face.normal_at(); angle=math.radians(180-data['tilt'])
        posed_z=n.Y*math.sin(angle)+n.Z*math.cos(angle)
        if n.Z>.1 and abs(n.Z)<.95:
            require(posed_z >= -math.sqrt(.5)-1e-6,'New sloped face exceeds 45 degree overhang in print pose')
            slope_faces.append(dict(area_mm2=face.area,normal_print_z=posed_z,
                                    overhang_from_vertical_degrees=math.degrees(math.asin(max(0.,-posed_z)))))
    require(len(slope_faces)>=6,'Expected six supported external ledges')
    for name,shape in source.items():
        require(native.fingerprint(shape)==data['fingerprints'][name],'Source BRep mutated')
    for path,digest in data['inputs'].items():
        require(io.digest(path)==digest,'Pinned file changed')
    return dict(valid_single_solids=True,source_material_preserved=True,bottom_unchanged=True,
                upper_20mm_and_central_50mm_space_unchanged=True,added_material_mm3=added_volume,
                keepout_trimmed_ramp_volume_mm3=volume(data['raw_ramps'])-volume(data['ramps']),
                cover_joints=joint_rows,joint_reactions=reactions,nut_loading=loading,
                full_tie_tail_tunnel_loop_head_bundle_witnesses_clear=True,
                continuous_bottom_withdrawal_mm=100,sloped_external_faces=slope_faces,
                actual_inputs_unchanged=True,external_ledge_gate=ledge_evidence(data))


def export(data,output):
    require(not output.exists(),'Use a fresh candidate directory')
    checks=validate(data)
    output.mkdir(parents=True)
    (output/'internal-mm').mkdir()
    records=[]
    validated=io.Artifacts()
    for name,shape in data['parts'].items():
        # Deliver assembly coordinates. Print transforms are separate and
        # explicit, so a slicer does not silently mistake grounding for pose.
        step=output/f'{data["kind"]}-leo-{name}.step'
        contexts=io.write_inch_step(shape,step)
        restored=import_step(step).solids()[0]
        io.equal(shape,restored,'STEP round trip changed '+name)
        stl=output/'internal-mm'/step.with_suffix('.stl').name
        require(export_stl(deepcopy(shape),stl,tolerance=.03,angular_tolerance=.1),'STL export failed')
        mass,error=io.adaptive_mass(shape); restored_mass,restored_error=io.adaptive_mass(restored)
        records.append(dict(name=name,volume_mm3=mass,restored_volume_mm3=restored_mass,
                            mass_integration='native adaptive closed-volume Eps1e-10; original rtol1e-6 unchanged',
                            mass_relative_error_estimates=[error,restored_error],
                            step=str(step.resolve()),step_sha256=io.digest(step),
                            stl=str(stl.resolve()),stl_sha256=io.digest(stl),active_step_length_contexts=contexts,
                            coordinate_frame='assembly_mm',source_to_print_translation_mm=[0.,0.,0.]))
        validated.load(records[-1])
        data['parts'][name]=restored
    validated.unchanged()
    checks=validate(data)
    archive=output/(data['kind']+'-leo-box-candidate.zip')
    with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as bundle:
        for row in records:
            for kind in ('step','stl'):bundle.write(row[kind],Path(row[kind]).name)
    with zipfile.ZipFile(archive) as bundle:
        require(bundle.testzip() is None and len(bundle.infolist())==4,'Wrong candidate archive')
        for row in records:
            for kind in ('step','stl'):
                require(io.hashlib.sha256(bundle.read(Path(row[kind]).name)).hexdigest()==row[kind+'_sha256'],'Archive changes part')
    sources={str(Path(m.__file__).resolve()):io.digest(m.__file__) for m in list(sys.modules.values())
             if getattr(m,'__file__',None) and str(m.__file__).endswith('.py') and '/hardware/cad/' in str(m.__file__)}
    sources[str(Path(__file__).resolve())]=io.digest(__file__)
    report=dict(scope='OPT_IN_LEO_BOX_EXTERNAL_LEDGE_RAMPS',kind=data['kind'],units='mm',
                geometry_checks_pass=True,review_components=records,checks=checks,
                archive=dict(path=str(archive.resolve()),sha256=io.digest(archive)),
                input_files=data['inputs'],source_code_sha256=sources,affected_features=data['features'],
                producer_source=dict(path=str(Path(__file__).resolve()),sha256=io.digest(__file__)),
                print_orientation=dict(shell_rotation_x_degrees=180-data['tilt'],bottom_rotation_x_degrees=0,
                    ground_after_rotation=True,
                    basis='Shell roof faces build plate; arcade inclined roof flattened before inversion'),
                unchanged_features=['All flat nut bearing faces, hex pockets, head seats and bottom mating datums',
                    'Closed 3.2 by 1.8 mm tie tunnels; complete 2.5 by 1.3 mm tail paths',
                    'Arcade bottom-mounted front eyes already grow from the bed; no added exterior ramps'],
                residual_bridge_regions=['Existing tie tunnel and full tie-loop passages interrupt exterior ramps',
                    'Cover screw bores remain open through the new ramps',
                    'Disco wide foot and remaining original horizontal surfaces require separate slicer review'],
                global_support_free_verified=False,physical_fit_verified=False,strength_verified=False,
                manufacturing_approved=False,no_viewer_writes=True)
    path=output/'receipt.json';path.write_text(json.dumps(report,indent=2)+'\n')
    print(path,flush=True);print(io.digest(path),flush=True)
    return report


def load_review(receipt_path, expected_sha, expected_kind):
    """Return (parts, provenance); parts are in original assembly millimetres.

    expected_sha is the coordinator's inspected receipt pin, never a value read
    from the untrusted receipt itself. This loader does not select or publish.
    """
    require(expected_kind in PINNED,'Unknown Leo box kind')
    path=Path(receipt_path); raw=path.read_bytes()
    require(io.hashlib.sha256(raw).hexdigest()==expected_sha,'Wrong Leo review receipt')
    report=json.loads(raw)
    require(report['scope']=='OPT_IN_LEO_BOX_EXTERNAL_LEDGE_RAMPS' and report['kind']==expected_kind,
            'Wrong Leo candidate scope or box kind')
    require(report['geometry_checks_pass'] is True,'Unverified Leo candidate')
    require(report['producer_source']['sha256']==io.digest(__file__),'Leo producer revision changed')
    require(report['input_files'].get(PINNED[expected_kind][0])==PINNED[expected_kind][1],
            'Wrong Leo parent selection')
    for field in ('input_files','source_code_sha256'):
        for filename,digest in report[field].items():
            require(io.digest(filename)==digest,'Changed bound Leo input: '+filename)
    rows=report['review_components']
    require(len(rows)==2 and {r['name'] for r in rows}=={'shell','bottom'},'Wrong Leo print inventory')
    artifacts=io.Artifacts(); parts={}
    for row in rows:
        require(row['coordinate_frame']=='assembly_mm','Unknown Leo coordinate frame')
        require(row['source_to_print_translation_mm']==[0.,0.,0.],'Unexpected Leo export transform')
        io.inch_length_contexts(row['step'])
        shape=artifacts.load(row)
        parts[row['name']]=shape.translate(tuple(-v for v in row['source_to_print_translation_mm']))
    artifacts.unchanged()
    require(path.read_bytes()==raw,'Leo receipt changed while loading')
    provenance=dict(receipt=dict(path=str(path.resolve()),sha256=expected_sha),kind=expected_kind,
                    input_files=report['input_files'],source_code_sha256=report['source_code_sha256'],
                    validated_artifact_files=artifacts.files,print_orientation=report['print_orientation'],
                    geometry_checks_pass=True,manufacturing_approved=False,
                    physical_fit_verified=False,global_support_free_verified=False)
    return parts,provenance


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind',choices=PINNED,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    export(build(args.kind),args.output)
