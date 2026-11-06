"""Real-export negative controls for the C bottom-off service mounting box."""
import argparse
from pathlib import Path
import sys
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import c_panel_service_mount as c


def reject(action,reason):
    try:action()
    except ValueError as error:assert reason in str(error),str(error)
    else:raise AssertionError('Unsafe panel-service mounting box admitted: '+reason)


parser=argparse.ArgumentParser(description=__doc__)
for name in ('base-receipt','candidate-receipt','bundle','receipt'):parser.add_argument('--'+name,type=Path,required=True)
args=parser.parse_args();data=c.prepare(args.base_receipt,args.candidate_receipt,args.bundle)
report=c.g.bind_input(data,'actual_panel_service_box',args.receipt)
actual={name:part for name,part in c.common.load_parts(data,report['review_components'])}
require=c.require
require(set(actual)==set(data['candidate']['parts']),'Incomplete actual service-box components')
for name,part in actual.items():
    original=data['candidate']['parts'][name]
    require(c.g.outside_volume(part,original)<1e-6 and c.g.outside_volume(original,part)<1e-6,'Actual service-box geometry differs: '+name)
data['candidate']['parts']=actual
data['fixed_ties']=dict(data['fixed_ties'],bottom=actual['shell'])
for (_,part),source in zip(c.common.load_parts(data,report['purchased_components']),c.washers(data)):
    require(c.g.outside_volume(part,source)<1e-6 and c.g.outside_volume(source,part)<1e-6,'Purchased washer envelope differs')
with patch.object(c,'WASHER_OD',6.):
    reject(lambda:c.verify_retention(data),'Washer loses guaranteed capsule overlap')
floor=data['candidate']['original']['floor_z']
cut=c.g.r.block(8.4,8.4,6.,(-11.,-38.,floor-.1))
shell=actual['shell']-cut
require(shell.is_valid and len(shell.solids())==1,'Invalid missing-eye mutation')
mutant=dict(data,candidate=dict(data['candidate'],parts=dict(actual,shell=shell)))
reject(lambda:c.verify_retention(mutant),'Missing printed cable anchor')
with patch.object(c,'service_data',lambda d:d):
    reject(lambda:c.verify_tools(data),'Tool service must omit the actual bottom')
life=c.verify_panel_lifecycle(data)
require(life['graph_sha256']==report['checks']['panel_service_lifecycle']['graph_sha256'],'Panel graph differs from actual box receipt')
require(life['reachable_states']==66 and life['C_projection_states']==39,'Unexpected composed state coverage')
c.g.unchanged(data)
print('PASS: actual exported box/washer identity; undersized stock washer, removed fixed cable eye and closed-panel tool service rejected; 66-state product/39 C states and all9 protocol mutations verified')
