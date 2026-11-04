"""Reject mislabeled STEP contexts and check the writer's global-unit isolation."""
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

from build123d import Box,Unit,export_step,import_step
from OCP.Interface import Interface_Static
from OCP.STEPCAFControl import STEPCAFControl_Controller
import arcade_bottom_chamfer as recipe


def reject(path):
    try:recipe.inch_length_contexts(path)
    except ValueError as error:return str(error)
    raise AssertionError('Non-inch STEP admitted: '+str(path))


def check(old_packet,output):
    results=[]
    for name in ('shell','bottom'):
        path=old_packet/('arcade-box-'+name+'.step')
        results.append(dict(case='delivered-v1-'+name+'-MM',rejected=True,reason=reject(path)))
    STEPCAFControl_Controller.Init_s();previous=Interface_Static.CVal_s('write.step.unit')
    with tempfile.TemporaryDirectory(prefix='arcade-step-unit-controls-') as folder:
        root=Path(folder);shape=Box(10,20,30).translate((7,9,11))
        try:
            assert Interface_Static.SetCVal_s('write.step.unit','MM')
            good=root/'inch.step';contexts=recipe.write_inch_step(shape,good)
            assert all(c['unit']=='INCH' and abs(c['metres_per_unit']-.0254)<1e-12 for c in contexts)
            recipe.equal(shape,import_step(good).solids()[0],'Non-origin inch roundtrip changed physical geometry')
            assert Interface_Static.CVal_s('write.step.unit')=='MM'
            ordinary=root/'ordinary-mm.step';export_step(shape,ordinary,unit=Unit.MM)
            results.append(dict(case='ordinary-MM-after-INCH-success',rejected_as_inch=True,reason=reject(ordinary)))
            recipe.equal(shape,import_step(ordinary).solids()[0],'Ordinary MM export changed physical geometry')
            fake=root/'unused-inch.step';text=ordinary.read_text()
            extra="""#999990 = DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);
#999991 = (CONVERSION_BASED_UNIT('INCH',#999992) LENGTH_UNIT() NAMED_UNIT(#999990));
#999992 = LENGTH_MEASURE_WITH_UNIT(25.4,#999993);
#999993 = (LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));
"""
            marker='ENDSEC;\nEND-ISO-10303-21;'
            assert marker in text;fake.write_text(text.replace(marker,extra+marker))
            results.append(dict(case='unused-INCH-definition-in-MM-file',rejected=True,reason=reject(fake)))
            wrong=root/'wrong-factor.step';text=good.read_text()
            changed=text.replace('LENGTH_MEASURE_WITH_UNIT(25.4,','LENGTH_MEASURE_WITH_UNIT(2.54,')
            assert changed!=text;wrong.write_text(changed)
            results.append(dict(case='INCH-label-with-wrong-factor',rejected=True,reason=reject(wrong)))
            with patch.object(recipe,'export_step',side_effect=RuntimeError('injected STEP write failure')):
                try:recipe.write_inch_step(shape,root/'failure.step')
                except RuntimeError as error:assert 'injected' in str(error)
                else:raise AssertionError('Injected writer failure was swallowed')
            assert Interface_Static.CVal_s('write.step.unit')=='MM'
            ordinary=root/'ordinary-mm-after-failure.step';export_step(shape,ordinary,unit=Unit.MM)
            results.append(dict(case='ordinary-MM-after-INCH-failure',rejected_as_inch=True,reason=reject(ordinary)))
            recipe.equal(shape,import_step(ordinary).solids()[0],'MM export after failure changed physical geometry')
        finally:
            assert Interface_Static.SetCVal_s('write.step.unit',previous)
    assert not output.exists()
    output.write_text(json.dumps(dict(passed=True,positive_inch_contexts=contexts,
        non_origin_physical_roundtrip_pass=True,writer_state_restored_after_success_and_failure=True,cases=results),indent=2)+'\n')
    print('PASS: active INCH contexts, physical placement, MM/unused-unit/wrong-factor negatives, and writer-state isolation')


if __name__=='__main__':check(Path(sys.argv[1]),Path(sys.argv[2]))
