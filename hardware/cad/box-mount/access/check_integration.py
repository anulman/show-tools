"""Regression for posed STEP assembly children and changing actual mesh inputs."""
import hashlib
from pathlib import Path
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parent))
import integrate_receipt as integration
from build123d import Align,Box

with tempfile.TemporaryDirectory(prefix='posed-STEP-check-') as folder:
    path=Path(folder)/'component'
    part=Box(4,4,4,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((27,27,10))
    integration.cad.export_part(part,path)
    step,stl=path.with_suffix('.step'),path.with_suffix('.stl')
    record=dict(name='posed fixture',step=str(step),stl=str(stl),volume_mm3=64,
                step_sha256=integration.digest(step),stl_sha256=integration.digest(stl))
    artifacts=integration.Artifacts()
    normalized=artifacts.load(record)
    physical=integration.pose(normalized,9)
    roof=Box(60,60,10,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,-10))
    overlap=integration.intersection(physical,roof)
    assert abs(overlap-64)<1e-6,f'Posed imported component collision hidden: {overlap}'
    # Never reuse cached geometry when an actual input artifact has changed.
    stl.write_bytes(stl.read_bytes()+b'changed')
    for check in (lambda:artifacts.load(record),artifacts.unchanged):
        try:
            check()
        except ValueError as error:
            assert 'Changed' in str(error) or 'changed' in str(error),str(error)
        else:
            raise AssertionError('Changed actual STL accepted')
print('PASS: posed STEP collision detected after solid normalization; changed STL rejected before cache reuse and at receipt boundary')

# Clear endpoint poses must not certify an intersecting path in between them.
fixed=Box(4,4,4,align=(Align.CENTER,Align.CENTER,Align.MIN))
bar=Box(2,2,2,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,6))
result=integration.detachment_witness(dict(released=[('fixed',fixed),('bar',bar)],
                                         detached=[('fixed',fixed),('bar',bar.translate((0,0,-10)))]))
assert result['endpoint_inferred_source_translation_mm']==-10
assert result['intermediate_intersections'] and not result['sampled_path_clear']
assert not result['continuous_path_verified']
print('PASS: clear released/detached endpoints do not hide an intermediate rigid collision')
