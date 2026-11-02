"""Independent concept diagnostics; no actual hardware-fit or load approval."""
from __future__ import annotations
import argparse,json,math
from copy import deepcopy
from pathlib import Path
import panel_mount_box_concept as concept
from build123d import import_step,extrude


def check(receipt,output):
    r=json.loads(receipt.read_bytes());records={q['name']:q for q in r['preview_components']}
    shell=import_step(records['shell']['step']).solids()[0];bottom=import_step(records['bottom']['step']).solids()[0]
    g=concept.g;checks={}
    with concept.previous.inherited.detached_booleans():
        checks['shell_bottom_overlap_mm3']=g.intersection(shell,bottom)
        withdrawal=deepcopy(bottom)
        for face in bottom.faces():
            if face.normal_at().Z>.9:withdrawal+=extrude(deepcopy(face),amount=-100,dir=(0,0,1))
        checks['continuous_bottom_withdrawal_100mm_overlap_mm3']=g.intersection(shell,withdrawal)
        source=g.compact.build();cable=source['original']['cable_envelope']
        checks['existing_cable_envelope_overlap_mm3']=g.intersection(shell,cable)
        checks['retained_cover_hardware']=[dict(name=j.name,
            screw_shell_overlap_mm3=g.intersection(shell,j.screw),nut_shell_overlap_mm3=g.intersection(shell,j.nut))
            for j in source['covers']['pairs']]
        panel=concept.previous.inherited.panel
        checks['retained_cover_tool_paths']=[dict(name=j.name,
            screw_withdrawal_14mm_overlap_mm3=g.intersection(shell,panel.screw_sweep(j,14.)),
            whole_AF2_key_phase_overlaps_mm3={phase:g.intersection(shell,shape) for phase,shape in panel.key2_bounds(j).items()})
            for j in source['covers']['pairs']]
        checks['retained_cover_nut_loading']=g.r.verify_nut_loading(source['covers']['pairs'],deepcopy(shell))
        # A tool-space reservation, not an invented model of an actual socket.
        access=g.cad.cyl(25,100,-103)
        checks['proposed_coaxial_50mm_tool_space_overlap_mm3']=g.intersection(shell,access)
        nominal=g.cad.cyl(14,100,-50)
        checks['nominal_drawing_28mm_body_roof_passage_overlap_mm3']=g.intersection(shell,nominal)
        ring=g.cad.ring(14.5,17,.05,-.05)
        checks['nominal_shoulder_down_0p05_bearing_witness_mm3']=g.intersection(shell,ring)
        checks['nominal_shoulder_annular_face_area_mm2']=math.pi*(17**2-14.5**2)
    overlaps=[checks[k] for k in ('shell_bottom_overlap_mm3','continuous_bottom_withdrawal_100mm_overlap_mm3',
        'existing_cable_envelope_overlap_mm3','proposed_coaxial_50mm_tool_space_overlap_mm3',
        'nominal_drawing_28mm_body_roof_passage_overlap_mm3')]
    for row in checks['retained_cover_hardware']:overlaps.extend([row['screw_shell_overlap_mm3'],row['nut_shell_overlap_mm3']])
    for row in checks['retained_cover_tool_paths']:
        overlaps.append(row['screw_withdrawal_14mm_overlap_mm3']);overlaps.extend(row['whole_AF2_key_phase_overlaps_mm3'].values())
    passed=all(math.isfinite(v) and 0<=v<1e-6 for v in overlaps) and checks['nominal_shoulder_down_0p05_bearing_witness_mm3']>0
    report=dict(scope='INDEPENDENT_UNVALIDATED_PANEL_MOUNT_CONCEPT_DIAGNOSTICS',listed_geometry_diagnostics_pass=passed,
                concept_receipt=dict(path=str(receipt.resolve()),sha256=concept.digest(receipt)),checks=checks,
                checker_source=dict(path=str(Path(__file__).resolve()),sha256=concept.digest(Path(__file__))),
                actual_nut_AF_and_tool_unknown=True,actual_fixed_shoulder_thickness_unknown=True,
                reported_rough_knob_underside_to_flange_top_mm=r.get('reported_measurements',{}).get('knob_underside_to_fixed_flange_top_mm'),
                physical_fit_verified=False,load_capacity_verified=False,tipping_stability_verified=False,
                note='50mm access is reserved space only, not a selected real tool or proof against unmeasured spinner internals')
    assert not output.exists();output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(checks,indent=2),flush=True);print(output,flush=True)
    if not passed:raise ValueError('Panel concept has a listed geometric obstruction; see preserved diagnostic report')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();check(args.receipt,args.output)
