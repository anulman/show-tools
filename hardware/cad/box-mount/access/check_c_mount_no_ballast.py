"""Real-export controls for ballast removal and exact5/7mm support fusion."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import c_mount_no_ballast as c


def reject(action,reason):
    try:action()
    except ValueError as error:assert reason in str(error),str(error)
    else:raise AssertionError('Unsafe C base simplification accepted: '+reason)


parser=argparse.ArgumentParser(description=__doc__)
for name in ('base-receipt','candidate-receipt','bundle','receipt'):parser.add_argument('--'+name,type=Path,required=True)
args=parser.parse_args();data=c.prepare(args.base_receipt,args.candidate_receipt,args.bundle)
report=c.g.bind_input(data,'actual_clean_C_base',args.receipt)
actual=dict(c.common.load_parts(data,report['review_components']))
assert set(actual)=={'shell','bottom','buffer','keeper_tab_0','keeper_tab_1'}
for name,part in actual.items():
    source=data['candidate']['parts'][name]
    c.require(c.g.outside_volume(part,source)<1e-6 and c.g.outside_volume(source,part)<1e-6,'Actual C base differs: '+name)
    data['candidate']['parts'][name]=part
data['shim']=c.common.load_parts(data,report['optional_components'])[0][1]
c.verify_support_fusion(data)
legacy_flat=c.g.compact.configuration(data['candidate'],7.)['parts']['height_shim']
reject(lambda:c.verify_support_fusion(dict(data,shim=legacy_flat)), 'Height cap changes original g7 occupied material')
unfused=dict(data,candidate=dict(data['candidate'],parts=dict(data['candidate']['parts'],shell=data['shell_before_support_fusion'])))
reject(lambda:c.verify_support_fusion(unfused),'Default support fusion changed occupied material')
restored=data['candidate']['parts']['shell']+data['original_shell_before_cleanup']
mutant=dict(data,candidate=dict(data['candidate'],parts=dict(data['candidate']['parts'],shell=restored)))
reject(lambda:c.verify_structure(mutant),'Internal ballast tray or ribs remain')
life=c.panel.verify_panel_lifecycle(data)
assert life['reachable_states']==66 and life['C_projection_states']==39 and len(life['negative_controls'])==9
c.g.unchanged(data)
print('PASS: actual four-print C base and profiled cap; wrong flat shim, unfused support and restored ballast rejected; both heights/axial cap path and66-state panel protocol verified')
