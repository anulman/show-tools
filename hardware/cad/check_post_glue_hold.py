"""The active Disco page must never fall through to a rejected collar."""
import ast
from pathlib import Path
import post_glue_review

source = Path(__file__).with_name('workspace.py').read_text()
tree = ast.parse(source)
main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
guard = next(node for node in main.body if isinstance(node, ast.If)
             and ast.unparse(node.test) == "args.workspace == 'disco-bar'")
assert isinstance(guard.body[-1], ast.Return)
assert ast.unparse(guard.body[-2].value.func) == 'post_glue_review.publish_reference_hold'
assert list(main.body).index(guard) < next(i for i, node in enumerate(main.body)
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'comparison' for t in node.targets))
facts = __import__('json').loads(Path(__file__).with_name('fabrication').joinpath('interface-facts.json').read_text())
assert facts['mounting_workflow']['pre_glue_captive_hardware_allowed'] is False
assert 'factory_assembly_before_glue' not in facts['mounting_workflow']
assert facts['fabrication']['modified_C2_collar_bar_hold']['status'] == 'rejected_for_fabrication_and_active_review'
print('PASS: rejected collar withdrawn from active Disco publication; historical files retained')
