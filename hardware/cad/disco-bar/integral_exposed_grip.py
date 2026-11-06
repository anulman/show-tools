"""Exploratory integral side grip below the original bar; no base alignment."""
from __future__ import annotations
import argparse,hashlib,importlib,json,sys
from copy import deepcopy
from pathlib import Path
from build123d import Axis,Cone,Compound,export_step,export_stl,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import disco_bar
m=importlib.import_module('disco-bar.post_glue_couplings');c=m.c;a=m.channels
u=importlib.import_module('disco-bar.reduced_c_subjects')
BASELINE_SHA='0eba8707d4eb21e42d276990f3c43d83c16d121b76f11ad04d32d122c01881f2'


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build(reference,baseline,exposure=32.,foot_radius=51.):
    if exposure<21. or exposure>60.:raise ValueError('Exploratory exposure must keep the complete shoe below the original root')
    if foot_radius<c.OUTER:raise ValueError('Exploratory foot must flare beyond original opening-fit radius')
    body=deepcopy(reference)+Cone(c.OUTER,foot_radius,exposure).translate((0,0,exposure/2))
    body-=c.pocket().translate((0,0,exposure))
    for sign in (-1,1):
        z=exposure-13.
        body-=c.box(14.,23.,15.,(sign*20.5,0,z))
        for y in (-12.,12.):body-=c.box(10.,3.,11.,(sign*22.5,y,z))
        body-=c.hexagon(5.8/(3**.5),3.6,(sign*28.5,0,z),'x')
        body-=c.cyl(1.8,10.,(sign*31.,0,z),'x')
        # Deep access recess preserves the finite original nut reaction roof.
        length=foot_radius+8.-33.
        body-=c.cyl(4.,length,(sign*(33.+length/2),0,z),'x')
    channels=a.source_channels(reference)
    for q in channels.values():
        # Keep the original lumen and continue it to the exposed mouth.
        body-=c.cyl(q['radius_mm'],exposure+.2,(*q['center_xy_mm'],exposure/2))
    if not body.is_valid or len(body.solids())!=1:raise ValueError('Integral bar is not one valid solid')
    parts=[c.Piece('integral full-height bar with exploratory exposed flared grip',body,'print')]
    for q in baseline['stages']['inserted']['components']:
        if not q['name'].startswith(('-1','+1')):continue
        for kind in ('step','stl'):
            if digest(q[kind])!=q[kind+'_sha256']:raise ValueError('Changed reusable grip actor')
        shape=import_step(q['step']).solids()[0].translate((0,0,exposure))
        parts.append(c.Piece(q['name'],shape,q['role']))
    return parts,channels


def export(source,baseline_path,output,exposure,foot_radius):
    if output.exists():raise ValueError('Use a fresh concept namespace')
    if digest(baseline_path)!=BASELINE_SHA:raise ValueError('Use the exact reduced-C grip actors')
    path,reference=disco_bar.load_reference(source);disco_bar.verify_full_reference(path,reference)
    parts,channels=build(reference,json.loads(baseline_path.read_text()),exposure,foot_radius)
    output.mkdir(parents=True);records=[]
    for i,p in enumerate(parts):
        stem=output/(f'{i:02d}-'+p.name.replace(' ','-').replace('+','plus'))
        step=stem.with_suffix('.step');stl=stem.with_suffix('.stl')
        if not export_step(deepcopy(p.shape),step) or not export_stl(deepcopy(p.shape),stl,tolerance=.03):raise ValueError('Concept export failed')
        actual=import_step(step)
        if not actual.is_valid or len(actual.solids())!=1:raise ValueError('Invalid concept STEP')
        records.append(dict(name=p.name,role=p.role,step=str(step.resolve()),stl=str(stl.resolve()),step_sha256=digest(step),stl_sha256=digest(stl),valid=True,solids=1))
        print('EXPORTED '+records[-1]['step'],flush=True)
    assembly=output/'integral-exposed-grip-CONCEPT-NOT-ADMITTED.step';export_step(Compound(children=[deepcopy(p.shape) for p in parts]),assembly)
    pins={str(Path(f).resolve()):digest(f) for f in (source,baseline_path,Path(__file__),Path(m.__file__),Path(c.__file__),Path(a.__file__),Path(disco_bar.__file__))}
    report=dict(schema=1,concept='integral exposed opposed-shoe grip',concept_render_only=True,manufacturing_approved=False,physical_fit_verified=False,post_glue_service_verified=False,source_files=pins,source_reference_sha256=digest(source),components=records,assembly_step=str(assembly.resolve()),assembly_step_sha256=digest(assembly),source_frame='original bar unchanged at Z=-109.22..0; positive Z is exposed below ball opening; root of ball is0; no base or fixed flange placement',exploratory_parameters=dict(exposure_below_original_root_mm=exposure,foot_outer_radius_mm=foot_radius,side_screw_axis_source_z_mm=exposure-13.,nominal_knob_socket_source_z_mm=[exposure-25.4,exposure],socket_bore_mm=2*c.R,socket_dimensions_are_not_measured_knob_dimensions=True,new_nominal_knob_top_stop_present=exposure>=26.9875,actual_fixed_flange_gap_mm=None),design_comparison='Straight full-width extension is simpler but bulky; selected one conical flare gives a continuous one-piece shell and exposed side recesses. Both were sketches only, not competing admitted mechanisms.',reused_actor_count=8,printed_physical_count=3,unique_print_designs=2,removed_parts=['separate cup','both collar halves','capture cover','M4 lock pair','cover M3 hardware'],pending=['Original profile/channel and extended-lumen checks','All actor post-glue insertion and reversal','Complete ordinary side tools and knob path','Actual knob-bottom to fixed-flange gap; base alignment withheld','FDM strength, tolerance, pad slip and spindle load','No new axial top stop when exposure is below26.9875mm; hand positions ball height during gripping'])
    (output/'concept.json').write_text(json.dumps(report,indent=2)+'\n');print('CONCEPT_MANIFEST '+str(output/'concept.json'),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source','baseline','output'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--exposure',type=float,default=32.);parser.add_argument('--foot-radius',type=float,default=51.)
    q=parser.parse_args();export(q.source,q.baseline,q.output,q.exposure,q.foot_radius)
