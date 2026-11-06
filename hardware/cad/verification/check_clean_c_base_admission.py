"""Reject altered combined proof results without rerunning native geometry."""
from __future__ import annotations
import argparse
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import clean_c_base_admission as combined


def result_mutants():
    return [
        ('failed fusion',lambda r:r['support_fusion'].__setitem__('exact_occupied_material_identity_g5_and_g7',False)),
        ('failed backing',lambda r:r['structure']['configurations']['5']['actual_C_bearing'].__setitem__('selected_patches_fully_backed_by_PTFE_and_support',False)),
        ('empty rotor stage',lambda r:r['rotors_with_blank_panel_closed'].__setitem__('locked',{})),
        ('omitted rotor actor',lambda r:r['rotors_with_blank_panel_closed']['locked']['5']['components'].pop()),
        ('sampled rotor',lambda r:r['rotors_with_blank_panel_closed']['locked']['5'].__setitem__('angular_samples_used',1)),
        ('failed root tool',lambda r:r['root_tools_panel_off']['actions'][0].__setitem__('whole_tool_sweep_vs_base_clear',False)),
        ('empty root phases',lambda r:r['root_tools_panel_off']['actions'][0].__setitem__('clearance_rows',[])),
        ('empty collision results',lambda r:r['root_tools_panel_off']['actions'][0]['clearance_rows'][0].__setitem__('intersections_mm3',{})),
        ('failed module',lambda r:r['module_and_grip_service']['5'].__setitem__('arbitrary_rotational_index_clear',False)),
        ('omitted race actors',lambda r:r['relaxed_C_recovery']['base_clear_for_bounded_recovery']['inserted'].__setitem__('5',[])),
        ('failed panel path',lambda r:r['panel_removal_refit'].__setitem__('continuous_panel_downward_removal_and_reverse_mm',0)),
        ('empty panel graph',lambda r:r.__setitem__('panel_service_lifecycle',{})),
    ]


def check(admission):
    combined.load(admission)
    config=json.loads(admission.read_bytes());original=combined.read_pin(config['compatibility'])
    with TemporaryDirectory(prefix='clean-c-proof-mutants-') as temporary:
        directory=Path(temporary)
        for index,(name,mutate) in enumerate(result_mutants()):
            proof=deepcopy(original);mutate(proof['checks'])
            target=directory/f'proof-{index}.json';target.write_text(json.dumps(proof))
            candidate=deepcopy(config);candidate['compatibility']=combined.pin(target)
            path=directory/f'admission-{index}.json';path.write_text(json.dumps(candidate))
            try:combined.load(path)
            except ValueError:pass
            else:raise AssertionError('Altered compatibility proof admitted: '+name)
    combined.load(admission)
    print('PASS: actual combined admission and twelve altered proof/config pairs rejected; no native geometry rerun')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--admission',type=Path,required=True)
    check(parser.parse_args().admission)
