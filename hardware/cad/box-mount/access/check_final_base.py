"""Actual-artifact regressions for final-C closed-cover entry and support."""
import argparse
from dataclasses import replace
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import final_base as model


def rejected(action, expected):
    try:
        action()
    except ValueError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError('Invalid geometry passed: '+expected)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--receipt', type=Path, required=True)
args = parser.parse_args()
producer = json.loads(args.receipt.read_text())
artifacts = model.integration.Artifacts()
gap = producer['box_source_transform']['mouth_box_z_mm']
p = model.cad.StackProposal(spacer_height=gap-1)
box = replace(model.cad.box_cad.Proposal(), tray_length=20, tray_y=42)
records = producer['control_sweeps']+producer['whole_tool_approach_sweeps']
probes = [(r['name'], model.integration.pose(artifacts.load(r), gap, 45)) for r in records]
candidate = model.make_candidate(p, box, probes)
checks = model.prior.verify_candidate(candidate)
assert checks['proposed_lift_mm'] > 15
model.clear_against(probes, model.obstacles(candidate), 'Complete entry')
rejected(lambda: model.prior.verify_candidate(candidate, lift_mm=15), 'inside the table')
rejected(lambda: model.prior.verify_candidate(dict(candidate, bottom=candidate['original']['bottom'])), 'probe is blocked')
base = candidate['original']
x, y = base['fastener_axes'][0]
cut = model.cad.cyl(box.boss_radius, box.bottom_thickness+1, base['underside_z']-.5).translate((x,y,0))
rejected(lambda: model.prior.verify_candidate(dict(candidate, bottom=candidate['bottom']-cut)), 'fastener seat')
cut = model.prior.Box(5,5,box.bottom_thickness+1,align=model.cad.MIN_Z).translate((0,box.tray_y,base['underside_z']-.5))
rejected(lambda: model.prior.verify_candidate(dict(candidate, bottom=candidate['bottom']-cut)), 'ballast floor')
# Reinstate the original front wiring reserve: it crosses the actual key tools.
old = model.cad.stack(p, box)
rejected(lambda: model.clear_against(probes, {'old_front_cable':old['cable_envelope']}, 'Original cable'), 'blocked')
# The top-level obstacle map must include stationary unit hardware.
blocked = dict(model.obstacles(candidate), stock_hex=probes[0][1])
rejected(lambda: model.clear_against(probes, blocked, 'Unit hardware'), 'stock_hex')
# Clear endpoints cannot certify withdrawal: put a small obstruction where the
# actual cap rim passes between released and detached poses.
states = {state: [(r['name'], artifacts.load(r)) for r in producer['states_components'][state]
                  if r['name'] == 'captive push-turn pin'] for state in ('released', 'detached')}
model.withdrawal_against_base(states, candidate, gap)
pin = model.integration.pose(states['released'][0][1], gap, 45)
bounds = pin.bounding_box()
cap = pin & model.prior.Box(180,180,.600001,align=model.cad.MIN_Z).translate((0,0,bounds.min.Z))
cb = cap.bounding_box()
core = model.cad.cyl(1.1,.8,bounds.min.Z-.1).translate(((cb.min.X+cb.max.X)/2,(cb.min.Y+cb.max.Y)/2,0))
obstruction = (cap-core).translate((0,0,.8))
assert obstruction.volume > .01
assert model.integration.intersection(pin, obstruction) < 1e-5
end = model.integration.pose(states['detached'][0][1], gap, 45)
assert model.integration.intersection(end, obstruction) < 1e-5
assert model.integration.intersection(pin.translate((0,0,.8)), obstruction) > .01
blocked_candidate = dict(candidate, study=dict(candidate['study'], shell=candidate['study']['shell']+obstruction))
rejected(lambda: model.withdrawal_against_base(states, blocked_candidate, gap), 'Cannot prove continuous withdrawal')
artifacts.unchanged()
print('PASS: full entry; reject 15 mm lift, intact cover, damaged seat, opened ballast, old cable, blocked stock hex and an intermediate-only withdrawal obstruction')
