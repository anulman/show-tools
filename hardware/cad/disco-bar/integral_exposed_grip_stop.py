"""Separate filled-core axial-stop option; original outer bar and channels retained."""
from __future__ import annotations
import argparse,hashlib,importlib,json,sys
from copy import deepcopy
from pathlib import Path
from build123d import Compound,export_step,export_stl,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
f=importlib.import_module('disco-bar.integral_exposed_grip');c=f.c


def run(concept,output):
    if output.exists():raise ValueError('Use a fresh stop-option namespace')
    original=json.loads(concept.read_text());E=original['exploratory_parameters']['exposure_below_original_root_mm']
    if E!=22.:raise ValueError('This comparison is the22mm exposure only')
    old=original['components'][0]
    if f.digest(old['step'])!=old['step_sha256']:raise ValueError('Changed original concept body')
    body=import_step(old['step']).solids()[0]
    # Fill the old socket's unused length, including its old entry bevel. A
    # small overlap remains within the existing cup wall and blind floor.
    body=deepcopy(body)+c.cyl(23.2,25.5,(0,0,-12.75))
    body-=c.pocket().translate((0,0,E))
    if not body.is_valid or len(body.solids())!=1:raise ValueError('Stop option is not one valid solid')
    output.mkdir(parents=True);step=output/'integral-exposed-grip-relocated-stop-CONCEPT.step';stl=step.with_suffix('.stl')
    if not export_step(deepcopy(body),step) or not export_stl(deepcopy(body),stl,tolerance=.03):raise ValueError('Stop export failed')
    actual=import_step(step)
    if not actual.is_valid or len(actual.solids())!=1:raise ValueError('Stop actual STEP invalid')
    record=dict(name='integral full-height bar with exposed grip and relocated nominal top stop',role='print',step=str(step.resolve()),stl=str(stl.resolve()),step_sha256=f.digest(step),stl_sha256=f.digest(stl),valid=True,solids=1)
    rows=[record,*deepcopy(original['components'][1:])];assembly=output/'integral-exposed-grip-relocated-stop-assembly-CONCEPT.step'
    export_step(Compound(children=[deepcopy(body),*[import_step(r['step']).solids()[0] for r in rows[1:]]]),assembly)
    report=deepcopy(original);report.update(concept='integral exposed grip with filled-core relocated nominal stop',components=rows,assembly_step=str(assembly.resolve()),assembly_step_sha256=f.digest(assembly),source_files=original['source_files']|{str(concept.resolve()):f.digest(concept),str(Path(__file__).resolve()):f.digest(__file__)},original_negative_z_material_equality_claimed=False,original_material_removal_permitted=False,permitted_original_void_fill='Only original central snug socket void above the retained blind floor; no outer profile or debond changes',pending=['Actual STEP retained original material and protected profile/channel checks','Relocated known pocket and full blind-floor positive-contact checks','Intrinsic post-glue8actor service and base/shoulder alignment','Actual knob top contact, strength, pad friction and FDM validation'])
    report['exploratory_parameters'].update(new_nominal_knob_top_stop_present=True,nominal_top_stop_source_z_mm=E-25.4,operator_reported_approx_fixed_flange_axial_thickness_mm=2.38125,operator_reported_no_visible_gap_above_flange=True,nominal_knob_underside_to_fixed_flange_top_gap_mm=0.,approximate_thickness_is_not_a_tolerance=True,nominal_source_to_world=dict(rotate_x_deg=180.,translate_z_mm=E+2.38125),actual_fixed_flange_thickness_mm=None)
    report['source_frame']='All original bar material and original exterior/profile reach at Z=-109.22..0 are retained; central original socket void is intentionally filled for the relocated stop. New exposed foot is Z0..22; no verified installed base alignment.'
    report['design_comparison']='Selected filled dead socket volume over thin stop disk (would seal an inaccessible old cavity/roof) or sparse ribs (would assume unknown actual knob-top bearing geometry). This is nominal contact only, not verified spindle load capacity.'
    (output/'concept.json').write_text(json.dumps(report,indent=2)+'\n');print(output/'concept.json',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('concept','output'):p.add_argument('--'+n,type=Path,required=True)
    q=p.parse_args();run(q.concept,q.output)
