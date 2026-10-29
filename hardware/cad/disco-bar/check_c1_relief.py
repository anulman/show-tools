"""Compare the diagnosed C1 lift snag with a bounded flange relief proposal."""
import argparse
import hashlib
import importlib
import json
from pathlib import Path
import sys
from build123d import export_step, export_stl, import_step
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--step', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
receipt_path = args.output / 'receipt.json'
receipt_path.unlink(missing_ok=True)
import disco_bar
m = importlib.import_module('disco-bar.couplings')
path, reference = disco_bar.load_reference(args.step)
disco_bar.verify_full_reference(path, reference)
assembly = m.c1(reference, 'released')
fixed = [p for p in assembly.parts if p.name.startswith('preset / ')]
moving = [p for p in assembly.parts if not p.name.startswith('preset / ')]
point = m.xy(38.5, 45)
relief = m.c.box(6.8, 6.8, 4, (*point, -1))
body = fixed[0].shape
relieved = body - relief
if not relieved.is_valid or len(relieved.solids()) != 1:
    raise ValueError('Relief invalidates fixed baseplate')
protected_cup = m.c.cyl(33, 30, (0, 0, -15))
m.c.assert_empty((body - relieved) & protected_cup, 'Relief changed knob cup')
carrier = next(p.shape for p in moving if p.name == 'fixed-to-bar latch carrier')
radial_bound = m.c.cyl(37.2, 200, (0, 0, -50))
housing = m.c.box(6, 6, 3.8, (*point, 5.1))
m.c.assert_empty(body - radial_bound, 'Fixed body exceeds reaction radius bound')
m.c.assert_empty((carrier & radial_bound) - housing, 'Inward carrier is not confined to key housing')
housing_sweep = m.c.box(6, 6, 38.8, (*point, -12.4))
m.c.assert_empty(housing_sweep & relieved, 'Continuous key-housing extraction sweep remains blocked')
if m.c.volume(housing_sweep & body) <= 1e-5:
    raise ValueError('Regression witness no longer reproduces original snag')
closed_pull = m.c1(reference, 'locked', bar_shift=-.4)
retainer = next(p.shape for p in closed_pull.parts if p.name == 'quarter-turn retainer')
if m.c.volume(retainer & relieved) <= 1e-5:
    raise ValueError('Relief removed intended locked capture')
findings = []
for shift in range(0, -36, -1):
    for part in moving:
        posed = part.shape.translate((0, 0, shift))
        for target in fixed:
            actual_target = relieved if target is fixed[0] else target.shape
            overlap = m.c.volume(posed & actual_target)
            if overlap > 1e-5:
                findings.append(dict(shift_mm=shift, moving=part.name, fixed=target.name, mm3=overlap))
report = dict(scope='PRIVATE_C1_FLANGE_RELIEF_PROPOSAL',
              source_sha256=hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest(),
              reference_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
              relief_box_mm=[6.8, 6.8, 4], relief_center_mm=[*point, -1],
              knob_cup_material_preserved=True, sampled_lift_mm=list(range(0, -36, -1)),
              intersections=findings, sampled_release_path_clear=not findings,
              continuous_key_housing_extraction_sweep_clear=True, locked_retainer_capture_preserved=True,
              continuous_path_or_strength_verified=False,
              operator_tool_engagement_verified=False, published=False)
output = args.output
output.mkdir(exist_ok=True)
step, stl = output/'relieved-baseplate.step', output/'relieved-baseplate.stl'
if not export_step(relieved, step) or not export_stl(relieved, stl, tolerance=.03):
    raise ValueError('Relieved cup export failed')
restored = import_step(step).solids()[0]
m.c.assert_empty(restored-relieved, 'STEP added material')
m.c.assert_empty(relieved-restored, 'STEP removed material')
mesh = trimesh.load_mesh(stl)
if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume <= 0 or abs(mesh.volume/relieved.volume-1)>.005:
    raise ValueError('Relieved cup STL invalid')
report['exports'] = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (step, stl)}
report['step_material_equality'] = True
report['stl_watertight_and_consistently_wound'] = True
report['sources_sha256'] = {Path(p).name:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in (__file__, m.__file__, m.pads.__file__, m.pads.previous.__file__, m.c.__file__, disco_bar.__file__)}
receipt_path.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
