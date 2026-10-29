"""Check confirmed axial clearance, finite corridor, and component separation."""
from dataclasses import replace
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).parents[1]))
from build123d import Align, Axis, Cylinder
from box_mount import ARCADE_CLEARANCE_MM, Proposal, build, required_centreline_depth, variant_requirements, volume

assert ARCADE_CLEARANCE_MM == 82.55
requirements = variant_requirements()
assert set(requirements['variants']) == {'arcade-inclined', 'rotor-level', 'mushroom-level'}
assert requirements['variants']['arcade-inclined']['clearance_datum'] == 'floor-axis'
assert not requirements['variants']['rotor-level']['drawing_hex_across_flats_verified']
for angle in (0, 5):
    projection = required_centreline_depth(tilt_degrees=angle)
    assert math.isclose(projection/math.cos(math.radians(angle)), 82.55)
p = Proposal()
p.validate()
shell, cover, *_ = build(p)
# Independent finite cylinder reaches 82.55 along the tilted axis and occupies
# its full proposed 27 mm diameter, including its lowest off-axis end point.
corridor = Cylinder(13.5, 82.55, align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,-82.55)).rotate(Axis.X,5)
assert volume(corridor & shell) < 1e-6 and volume(corridor & cover) < 1e-6
assert corridor.bounding_box().min.Z - cover.bounding_box().max.Z >= .5-1e-6
for bad in (replace(p,depth=35.25), replace(p,depth=82.3), replace(p,clearance_mm=82.5)):
    try:
        bad.validate()
    except ValueError:
        pass
    else:
        raise AssertionError('insufficient axial or finite-corridor reserve accepted')
# Reporting requirements must not export CAD.
source = Path(__file__).parents[1]/'box_mount.py'
with tempfile.TemporaryDirectory(prefix='box-requirements-') as directory:
    result = subprocess.run([sys.executable,str(source),'--requirements','--output',directory], capture_output=True,text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == requirements
    assert not list(Path(directory).iterdir())
print('PASS: three distinct variants, 82.55 mm axial reserve, full proposed corridor, shallow reserves rejected')
