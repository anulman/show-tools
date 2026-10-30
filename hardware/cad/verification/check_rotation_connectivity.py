from copy import deepcopy
from rotation_connectivity import verify
from post_glue_lifecycle import Violation

# Checker fixture: the formerly missing cup-to-bar drive must fail.
nodes=dict(bar='rotor',collar='rotor',cup='rotor',knob='rotor',box='stationary')
joints=[dict(id='bayonet',actors=['bar','collar'],kind='positive-drive',geometry_evidence='fixture'),
        dict(id='race',actors=['cup','collar'],kind='unlimited-bearing',geometry_evidence='fixture'),
        dict(id='pads',actors=['cup','knob'],kind='pad-grip',geometry_evidence='fixture',physical_slip_resistance_verified=False)]
try:verify(nodes,joints)
except Violation as error:assert 'freewheel' in str(error)
else:raise AssertionError('Freewheeling collar accepted')
joints.append(dict(id='axial keys',actors=['cup','bar'],kind='positive-drive',geometry_evidence='fixture'))
verify(nodes,joints)
for broken,phrase in [
    (joints+[dict(id='base tie',actors=['bar','box'],kind='positive-drive',geometry_evidence='fixture')],'stationary base'),
    ([dict(j,angular_limit_degrees=360) if j['id']=='race' else j for j in joints],'rotation limit'),
    ([dict(j,kind='pad-grip',physical_slip_resistance_verified=False) if j['id']=='axial keys' else j for j in joints],'friction substituted')]:
    try:verify(nodes,broken)
    except Violation as error:assert phrase in str(error),str(error)
    else:raise AssertionError('Invalid kinematic graph admitted')
print('PASS: freewheeling collar, base tie, finite bearing stop and substitute friction rejected; fixture only')
