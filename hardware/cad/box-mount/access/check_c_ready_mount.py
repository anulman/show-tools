"""Reject unsafe C box identification and blocked actual ordinary-tool access."""
import argparse
from copy import deepcopy
from pathlib import Path
import sys
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import c_ready_mount as c


def reject(action,reason):
    try:action()
    except ValueError as error:assert reason in str(error),str(error)
    else:raise AssertionError('Invalid C mounting box admitted: '+reason)


parser=argparse.ArgumentParser(description=__doc__)
for name in ('base-receipt','candidate-receipt','bundle'):parser.add_argument('--'+name,type=Path,required=True)
args=parser.parse_args();data=c.prepare(args.base_receipt,args.candidate_receipt,args.bundle)
bottom=data['candidate']['parts']['bottom'];z=data['candidate']['original']['underside_z']
masks=c.markers(z)
reject(lambda:c.verify_marks(data['original_bottom'],data['original_bottom'],z,masks),
       'C bottom differs outside declared shallow identifiers')
# The first real layout put C over an existing cable passage and failed its web witness.
with patch.dict(c.LABELS,{'C':(0.,-49.)}):
    bad,bad_masks=c.mark_bottom(data['original_bottom'],z)
    reject(lambda:c.verify_marks(data['original_bottom'],bad,z,bad_masks),'Identifier leaves insufficient floor web: C')
with patch.object(c,'DEPTH',1.):
    bad,bad_masks=c.mark_bottom(data['original_bottom'],z)
    reject(lambda:c.verify_marks(data['original_bottom'],bad,z,bad_masks),'Identifier leaves insufficient floor web')
with patch.object(c,'INDEX',0.):
    reject(lambda:c.verify_tools(data),'Wrong C lock index')
x,y=c.gate.port_point('lock')
blocked=bottom+c.gate.r.block(12,12,3,(x,y,z))
assert blocked.is_valid and len(blocked.solids())==1
candidate=dict(data['candidate'],parts=dict(data['candidate']['parts'],bottom=blocked),
               ties=dict(data['candidate']['ties'],bottom=blocked))
reject(lambda:c.verify_tools(dict(data,candidate=candidate)),'Bound lifecycle tool against compact base blocked')
# Rerun real-candidate protocol mutations, not just generic fixtures.
import candidate_protocol
import post_glue_lifecycle
model=deepcopy(data['manifests']['C_protocol'])
controls=candidate_protocol.negative_controls(model,candidate_protocol.expected_inventory('C'))
assert {'preinstalled hardware','missing final unlock','above-root side access'}<=set(controls)
post_glue_lifecycle.verify_evidence(model,args.bundle)
c.gate.unchanged(data)
print('PASS: actual C bottom identifiers and remaining floor; original cable-layout, deep labels, wrong index and connected blocked port rejected; real C protocol mutations rejected and restored model passes')
