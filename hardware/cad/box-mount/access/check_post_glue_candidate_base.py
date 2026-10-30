"""Check actual exported post-glue stage rotors against the frozen compact base.

This does not certify tool motion, retention, bar preservation or lifecycle reachability.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import post_glue_base_gate as gate
from build123d import Axis

PRODUCER_SOURCES={'post_glue_couplings.py','check_post_glue_candidates.py','full_height.py',
                  'standard_collar.py','couplings.py','debond_checks.py','check_couplings.py','disco_bar.py'}
REFERENCE_SHA='f0a21384179b69eff79205032dad536bfa1350e358c25ed0fe01de4189f2e003'


def run(base_receipt,candidate_receipt,worktree,output):
    gate.require_fresh_namespace(output)
    own=Path(__file__).resolve();own_sha=gate.audit.digest(own)
    data=gate.load_base(base_receipt);data['sources'][own.name]=(own,own_sha)
    manifest=gate.bind_input(data,'candidate',candidate_receipt)
    gate.audit.require(manifest['bar_already_glued'] is True and manifest['above_root_exterior_access'] is False,
                       'Candidate does not use bare-glued-bar access boundary')
    gate.audit.require(set(manifest['source_code_sha256'])==PRODUCER_SOURCES,'Incomplete post-glue producer source inventory')
    commit=gate.audit.source_revision(worktree,manifest['source_commit'],manifest['source_code_sha256'])
    gate.audit.require(manifest['reference_sha256']==REFERENCE_SHA,'Wrong raw bar reference identity')
    bar=gate.load_records(data,[manifest['environment']],{manifest['environment']['name']})
    gate.audit.require(abs(bar[0][1].bounding_box().size.Z-109.22)<1e-6,'Bar is not full height')
    stages=manifest['stages'];gate.audit.require('outside' in stages and 'locked' in stages,'Missing outside/locked stage')
    names={record['name'] for record in stages['outside']['components']}
    gate.audit.require(bool(names),'Missing removable geometry inventory')
    expected_cup='removable padded knob cup'
    gate.audit.require(expected_cup in names,'Missing cup anchor for source/world pose binding')
    results={};anchor=None
    for stage,definition in stages.items():
        parts=gate.load_records(data,definition['components'],names)
        pose=definition['source_pose'];shift=pose['shift'];angle=pose['angle']
        cup=dict(parts)[expected_cup].rotate(Axis.Z,-angle).translate((0,0,-shift))
        if anchor is None:anchor=cup
        gate.audit.require(gate.outside_volume(cup,anchor)<1e-6 and gate.outside_volume(anchor,cup)<1e-6,
                           'Cup source shift/angle does not preserve fixed world anchor: '+stage)
        results[stage]={}
        for gap in (5.,7.):
            mouth=gap+shift
            # Relative stage angle is already baked into each exported component.
            posed=[(name,gate.audit.pose(part,mouth,-90)) for name,part in bar+parts]
            try:
                result=gate.check_rotor(data,posed,gap)
                results[stage][str(int(gap))]=dict(base_rotary_clear=True,mouth_z_mm=mouth,
                                                 components=result['components'],certificate=result['certificate'])
                print('BASE ROTARY CLEAR',stage,'base',gap,'mouth',mouth,'parts',len(posed),flush=True)
            except ValueError as error:
                results[stage][str(int(gap))]=dict(base_rotary_clear=False,mouth_z_mm=mouth,error=str(error))
                print('BASE ROTARY NOT CERTIFIED',stage,gap,str(error),flush=True)
    passed=all(v['base_rotary_clear'] for values in results.values() for v in values.values())
    report=dict(scope='ACTUAL_POST_GLUE_STAGE_BASE_ROTARY_CHECK_ONLY',source_commit=commit,concept=manifest['concept'],
                results=results,all_provided_stages_base_rotary_clear=passed,
                cup_anchor_source_shift_cancelled_with_physical_mouth_height=True,
                stage_inventory_names=sorted(names),environment_bar_name=bar[0][0],
                lifecycle_registry_must_independently_establish_inventory_completeness=True,
                mechanical_co_rotation_and_capture_require_independent_evidence=True,
                continuous_part_and_tool_motion_admitted=False,lifecycle_admitted=False,
                physical_fit_or_strength_admitted=False,angular_samples_used=0)
    target,digest=gate.freeze_report(data,report,output)
    print(target);print(digest)
    return passed


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('base-receipt','candidate-receipt','source-worktree','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    passed=run(args.base_receipt,args.candidate_receipt,args.source_worktree,args.output)
    if not passed:raise SystemExit(1)
