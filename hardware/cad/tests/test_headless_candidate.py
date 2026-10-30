"""Workflow failures must never leave a success receipt or overwrite older work."""
import importlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / 'box-mount' / 'access'))
import headless_candidate as command
model = importlib.import_module('measured_hex_joint')


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='cad-command-test-')
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name) / 'trial'
        self.staging = Path(self.temporary.name) / 'unpublished'
        self.staging.mkdir()

    def test_existing_work_is_not_modified(self):
        self.output.mkdir()
        receipt = self.output / 'receipt.json'
        receipt.write_text('previous work')
        result = command.run(self.output, self.staging)
        self.assertEqual(result['kind'], 'gate-failed')
        self.assertEqual(receipt.read_text(), 'previous work')

    def test_each_real_guard_calls_original_and_restores_after_failure(self):
        for module in (model.audit, model.cad, model.cad.box_cad):
            original = module.require
            with patch.object(module, 'require', wraps=original) as spy:
                with self.assertRaises(command.ProductGateFailure):
                    with command.tagged_guards(model):
                        module.require(True, 'passing guard')
                        module.require(False, 'failed guard')
                self.assertIs(module.require, spy)
                self.assertEqual(spy.call_args_list[0].args, (True, 'passing guard'))
                self.assertEqual(spy.call_args_list[1].args, (False, 'failed guard'))
            self.assertIs(module.require, original)

    def test_guard_bug_is_not_translated_to_product_rejection(self):
        for module, exception in ((model.audit, ValueError), (model.cad, ValueError), (model.cad.box_cad, RuntimeError)):
            for condition, message, raised in ((True, 'passing guard', 'passing guard'),
                                                (False, 'failed guard', 'unexpected implementation error')):
                with patch.object(module, 'require', side_effect=exception(raised)):
                    with command.tagged_guards(model):
                        with self.assertRaises(exception) as error:
                            module.require(condition, message)
                        self.assertNotIsInstance(error.exception, command.ProductGateFailure)

    def test_real_validator_failure_prevents_export(self):
        def fail(_coupon):
            model.audit.require(False, 'Deliberate product gate failure')
        with patch.object(model, 'verify', fail), patch.object(model, 'export') as export:
            result = command.run(self.output, self.staging)
        self.assertEqual(result['kind'], 'gate-failed')
        self.assertEqual(result['stage'], 'validation')
        self.assertIn('Deliberate product gate', result['cause'])
        export.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_untyped_value_error_is_a_chief_handoff(self):
        with patch.object(command.runpy, 'run_path', side_effect=ValueError('unexpected bug')):
            result = command.run(self.output, self.staging)
        self.assertEqual(result['kind'], 'execution-failed')
        self.assertEqual(result['cause'], 'ValueError')
        self.assertFalse(self.output.exists())

    def test_real_export_runtime_guard_is_a_product_rejection(self):
        def reject_export(*_args):
            model.cad.box_cad.require(False, 'Deliberate export product guard')
        with patch.object(model, 'export', reject_export):
            result = command.run(self.output, self.staging)
        self.assertEqual(result['kind'], 'gate-failed')
        self.assertEqual(result['stage'], 'export')
        self.assertIn('Deliberate export', result['cause'])
        self.assertFalse(self.output.exists())
        self.assertFalse((self.staging / 'receipt.json').exists())

    def test_negative_fixture_assertion_is_not_product_failure(self):
        with patch.object(command.runpy, 'run_path', side_effect=AssertionError('broken fixture')):
            result = command.run(self.output, self.staging)
        self.assertEqual(result['kind'], 'execution-failed')
        self.assertEqual(result['cause'], 'AssertionError')

    def test_actual_exports_pass_then_corruption_removes_success_receipt(self):
        original = model.export

        def corrupt(coupon, output):
            original(coupon, output)
            with (output / 'print' / 'measured-hex-well.stl').open('ab') as file:
                file.write(b'changed')
        with patch.object(model, 'export', corrupt):
            result = command.run(self.output, self.staging)
        self.assertEqual(result['kind'], 'gate-failed')
        self.assertEqual(result['stage'], 'receipt')
        self.assertFalse(self.output.exists())
        self.assertFalse((self.staging / 'receipt.json').exists())
        self.assertTrue((self.staging / 'print' / 'measured-hex-well.stl').exists())

    def test_actual_recipe_emits_only_a_checked_trial(self):
        result = command.run(self.output, self.staging)
        self.assertEqual(result['kind'], 'validated')
        self.assertEqual(result['receipt'], command.check_receipt(self.staging, self.output, 'receipt.pending.json'))
        self.assertFalse(self.output.exists())
        self.assertFalse((self.staging / 'receipt.json').exists())
        report = json.loads((self.staging / 'receipt.pending.json').read_text())
        self.assertEqual(len(report['review_components']), 2)
        self.assertFalse(report['physical_fit_preload_and_strength_verified'])


if __name__ == '__main__':
    unittest.main()
