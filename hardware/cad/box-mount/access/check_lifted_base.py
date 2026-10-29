"""Actual-probe negative checks for the proposed lifted, closed-cover base."""
import argparse
from dataclasses import replace
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
import lifted_base as model
from build123d import Box

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--receipt',type=Path,required=True)
args=parser.parse_args()
producer=json.loads(args.receipt.read_text());artifacts=model.integration.Artifacts()
p=model.cad.StackProposal(spacer_height=producer['box_source_transform']['mouth_box_z_mm']-1)
box=replace(model.cad.box_cad.Proposal(),tray_length=20,tray_y=42)
probes=[(record['name'],model.integration.pose(artifacts.load(record),p.bar_mouth_z,45)) for record in producer['control_sweeps']]
candidate=model.make_candidate(p,box,probes)
checks=model.verify_candidate(candidate)
assert checks['supplied_probes_clear_with_cover_installed'] and checks['operator_allows_lifting']
# Restore the intact old cover: it must obstruct the actual probes again.
wrong=dict(candidate,bottom=candidate['original']['bottom'])
try:
    model.verify_candidate(wrong)
except ValueError as error:
    assert 'probe is blocked' in str(error),str(error)
else:
    raise AssertionError('Unported cover falsely passed closed-cover service')
# Authorized lifting must be large enough for the full actual probe extent.
try:
    model.verify_candidate(candidate,lift_mm=0)
except ValueError as error:
    assert 'inside the table' in str(error),str(error)
else:
    raise AssertionError('No-lift tabletop entry falsely passed')
# Removing mounting material is invalid even when the cover stays one solid.
base=candidate['original'];x,y=base['fastener_axes'][0]
cut=model.cad.cyl(box.boss_radius,box.bottom_thickness+1,base['underside_z']-.5).translate((x,y,0))
wrong=dict(candidate,bottom=candidate['bottom']-cut)
try:
    model.verify_candidate(wrong)
except ValueError as error:
    assert 'fastener seat' in str(error),str(error)
else:
    raise AssertionError('Damaged cover fastener seat accepted')
cut=Box(5,5,box.bottom_thickness+1,align=model.cad.MIN_Z).translate((0,box.tray_y,base['underside_z']-.5))
wrong=dict(candidate,bottom=candidate['bottom']-cut)
try:
    model.verify_candidate(wrong)
except ValueError as error:
    assert 'ballast floor' in str(error),str(error)
else:
    raise AssertionError('An opened ballast floor was accepted')
artifacts.unchanged()
print('PASS: actual probes clear closed cover when lifted; original cover, no lift, damaged seat and opened ballast floor rejected')
