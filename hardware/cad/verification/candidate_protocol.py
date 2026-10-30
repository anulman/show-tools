"""Artifact-bound operating protocols for the three post-glue mechanisms.

The finite model covers the instructed sequence and its interruption/reversal,
not arbitrary misassembly, damage or a user's deliberate removal of safeguards.
Geometry evidence is checked independently before publication admission.
"""
from __future__ import annotations
from copy import deepcopy
from dataclasses import asdict
import hashlib,json
from pathlib import Path
from post_glue_lifecycle import verify_inventory,verify_evidence,Violation


def expected_inventory(concept):
    """Independent bill-of-materials contract, including every purchased actor."""
    roles={'removable padded knob cup':'printed','external axial screw capture cover':'printed'}
    for sign in ('-1','+1'):
        for suffix,role in [('retained padded shoe','printed'),('cut-stock adhesive-backed pad envelope','pad'),
                            ('preset set-screw envelope','hardware'),('captive nut envelope','hardware')]:
            roles[sign+' '+suffix]=role
    cover=(15.,130.,200.,310.) if concept=='C' else (15.,200.,310.)
    for angle in cover:
        for prefix in ('external cover M3x8 screw ','external cover M3 nut '):roles[prefix+str(angle)]='hardware'
    locks={'A':(45.,110.,260.),'B':(95.,),'C':(110.,)}[concept]
    for angle in locks:
        for prefix in ('axial M4x12 socket screw ','threaded M4 full nut '):roles[prefix+str(angle)]='hardware'
    if concept=='C':
        roles.update({'removable collar half A':'printed','removable collar half B':'printed'})
    return {name:dict(role=role,module='detachable module') for name,role in roles.items()}


def build(concept,receipt,evidence):
    inventory=expected_inventory(concept)
    actual={q['name']:{'print':'printed','hardware':'hardware','pad':'pad'}[q['role']]
            for q in receipt['stages']['inserted']['components']}
    if actual!={name:q['role'] for name,q in inventory.items()}:raise Violation('Actual export differs from independently enumerated bill of materials')
    actors=sorted(inventory)
    model=dict(schema=1,concept=concept,bar_already_glued=True,above_root_exterior_access=False,
        environment=['bare printed bar permanently glued to ball; no installed coupling hardware',
                     'box and stock hex secured before the detachable module is lowered over the knob',
                     'box may be supported180mm above table on ordinary bench blocks for underside tool access'],
        scope='Exhaustive instructed protocol including all intermediate stops and reverse operations; physical force/fit excluded',
        parts={n:dict(initial='outside',final='secured',role=q['role']) for n,q in inventory.items()},
        modules={'detachable module':actors},variables={},actions=[],evidence=evidence)
    def variable(name,domain,initial,final):
        model['variables'][name]=dict(domain=domain,initial=initial,final=final,owners=['detachable module'])
    def pair(name,requires,sets,tool,category,checks,external=False,reverse_name=None):
        before=requires.copy();after=requires|sets
        common=dict(tool=tool,access='external-module' if external else 'root',geometry_evidence=category,
                    evidence_checks=checks,operator_hands_max=2,bar_glue_unchanged=True)
        if external:
            before.update({n:'outside' for n in actors});after.update({n:'outside' for n in actors})
            safe={'root drive key':False,'M4 key':False,'root phase':'outside'}
            before.update(safe);after.update(safe)
            common['external_parts']=actors
        model['actions'].extend([dict(id=name,requires=before,sets=sets,**common),
            dict(id=reverse_name or 'reverse: '+name,requires=after,sets={n:before[n] for n in sets},**common)])
    # Outside assembly is ordered so the evidence never silently assumes that a
    # cover, screw or nut which blocks an approach has not yet been installed.
    steps=[]
    for sign in ('-1','+1'):
        steps.extend([(sign+' pad attachment and peel reverse','hand'),
                      (sign+' shoe axial entry and reverse','hand'),
                      (sign+' shoe radial seating and reverse','hand'),
                      (sign+' grip nut entry and reverse','hand'),
                      (sign+' preset set-screw envelope external thread-on and reverse','1.5 mm hex key')])
    if concept=='C':
        steps.append(('split collar and common cover assembly outside ball','2 mm hex key'))
    else:
        for angle in ({'A':(45.,110.,260.),'B':(95.,)}[concept]):
            steps.extend([(f'axial M4x12 socket screw {angle} external axial entry and reverse','hand'),
                          (f'threaded M4 full nut {angle} external thread-on and reverse','hand')])
        for angle in (15.,200.,310.):steps.append((f'cover nut {angle} entry and reverse','hand'))
        steps.append(('capture cover axial installation and reverse','hand'))
        for angle in (15.,200.,310.):steps.append((f'external cover M3x8 screw {angle} axial installation and reverse','2 mm hex key'))
    variable('outside assembly',list(range(len(steps)+1)),0,len(steps))
    variable('on OEM knob',[False,True],False,True)
    variable('grip',[False,True],False,True)
    variable('root phase',['outside','entered','turned','registered','locked'],'outside','locked')
    for i,(name,tool) in enumerate(steps):
        pair(name,{'outside assembly':i,'on OEM knob':False,'grip':False},
             {'outside assembly':i+1},tool,'external',[name],external=True)
    pair('lower complete released module over knob',{'outside assembly':len(steps),'on OEM knob':False,'grip':False},
         {'on OEM knob':True},'hand','module',['continuous knob entry and box withdrawal'],external=True)
    pair('tighten two padded grip screws with ordinary AF1.5 key',
         {'outside assembly':len(steps),'on OEM knob':True,'grip':False}, {'grip':True},
         '1.5 mm hex key','external',['-1 grip key entry','-1 grip key operation','-1 grip key withdrawal',
                                      '+1 grip key entry','+1 grip key operation','+1 grip key withdrawal'],external=True)
    if concept=='C':
        c_root(actors,pair,variable)
        return model,inventory
    entry={n:'outside' for n in actors}|{'outside assembly':len(steps),'on OEM knob':True,'grip':True,'root phase':'outside','root drive key':False,'M4 key':False,'completed screw turns':0}
    pair('lower glued ball over fully outside assembled module',entry,
         {n:'inserted' for n in actors}|{'root phase':'entered'},'hand','root',['complete axial insertion and identical reverse'])
    variable('root drive key',[False,True],False,False)
    variable('M4 key',[False,True],False,False)
    pair('engage ordinary AF4 drive key from underside',{'root phase':'entered','root drive key':False,'M4 key':False,'completed screw turns':0},
         {'root drive key':True},'4 mm hex key','tools',['entry','withdrawal'])
    pair('turn detachable coupling35 degrees with ball held in other hand',{'root phase':'entered','root drive key':True,'M4 key':False,'completed screw turns':0},
         {'root phase':'turned'},'4 mm hex key','root',['continuous35 degree turn; reverse identical'])
    pair('seat full nuts in positive hex registers with axial ball lift',{'root phase':'turned','root drive key':True,'M4 key':False,'completed screw turns':0},
         {'root phase':'registered'},'hand','root',['continuous2.1mm register stroke; reverse identical'])
    pair('remove AF4 key after positive nut registration',{'root phase':'registered','root drive key':True,'M4 key':False,'completed screw turns':0},
         {'root drive key':False},'4 mm hex key','tools',['entry','withdrawal'])
    pair('engage ordinary AF3 screw key after drive key withdrawal',{'root phase':'registered','root drive key':False,'M4 key':False,'completed screw turns':0},
         {'M4 key':True},'3 mm hex key','tools',['entry','operation','withdrawal'])
    # Exactly one turn per bolt per round bounds A's nut-height mismatch to
    #0.7mm <1.5mm hex registration. The whole assembly is indexed only with
    #both tools removed; each operation includes that staged ordinary-key cycle.
    count=9 if concept=='A' else 3
    variable('completed screw turns',list(range(count+1)),0,count)
    for i in range(count):
        pair(f'round{i//3+1} bolt{i%3+1} full turn and hand-supported ball during key withdrawal/index/re-entry' if concept=='A' else f'lock screw full turn{i+1}',
             {'root phase':'registered','root drive key':False,'M4 key':True,'completed screw turns':i},
             {'completed screw turns':i+1},'3 mm hex key','tools',
             ['whole key entry operation withdrawal; tools out for indexing','positive nut register and head capture'])
    pair('withdraw screw key and accept fully locked rotor',
         {'root phase':'registered','root drive key':False,'M4 key':True,'completed screw turns':count}|{n:'inserted' for n in actors},
         {'M4 key':False,'root phase':'locked'}|{n:'secured' for n in actors},'3 mm hex key','tools',['withdrawal'])
    # Reverse actions are the instructed inverse. No installed side access,
    #complete unthreading inside the bar, or glue-removal action exists.
    return model,inventory



def c_root(actors,pair,variable):
    """Two-hand C force transfer; never turn a loose unsupported collar."""
    variable('root drive key',[False,True],False,False)
    variable('M4 key',[False,True],False,False)
    variable('collar support',['loose','AF4 push','AF3 push','clamped'],'loose','clamped')
    variable('head condition',['captured float permitted','seated'],'captured float permitted','seated')
    variable('completed screw turns',[0,1,2,3],0,3)
    outside={n:'outside' for n in actors}
    pair('engage AF4 key and press collar to upper race stop delta=-0.5',
         outside|{'root phase':'outside','on OEM knob':True,'grip':True,'root drive key':False,'M4 key':False,
                  'collar support':'loose','head condition':'captured float permitted','completed screw turns':0},
         {'root drive key':True,'collar support':'AF4 push'},'4 mm hex key','tools',
         ['full AF4 approach; positive socket floor push to collar upper stop'])
    pair('lower glued ball over whole externally assembled module while AF4 holds upper stop',
         outside|{'root phase':'outside','root drive key':True,'M4 key':False,'collar support':'AF4 push','completed screw turns':0},
         {n:'inserted' for n in actors}|{'root phase':'entered'},'hand','root',
         ['fixed cup and collar complete50mm axial insertion and reverse; upper stop held'])
    pair('turn collar35 degrees with AF4 push and other hand on ball',
         {'root phase':'entered','root drive key':True,'M4 key':False,'collar support':'AF4 push','completed screw turns':0},
         {'root phase':'turned'},'4 mm hex key','root',
         ['continuous35 degree turn at delta=-0.5 including captured head float0..0.5'])
    pair('rest ball on PTFE and engage AF3 key to seat screw head',
         {'root phase':'turned','root drive key':True,'M4 key':False,'collar support':'AF4 push',
          'head condition':'captured float permitted','completed screw turns':0},
         {'M4 key':True,'head condition':'seated'},'3 mm hex key','tools',
         ['simultaneous AF3 and AF4 complete bodies and base approaches; socket floor contact'])
    pair('transfer upper-stop push from AF4 to AF3 with ball resting on PTFE',
         {'root phase':'turned','root drive key':True,'M4 key':True,'collar support':'AF4 push',
          'head condition':'seated','completed screw turns':0},
         {'collar support':'AF3 push'},'3 mm hex key','tools',
         ['AF3 key floor to screw head seat to collar to fixed cup upper stop'])
    pair('withdraw AF4 while AF3 maintains upper-stop push',
         {'root phase':'turned','root drive key':True,'M4 key':True,'collar support':'AF3 push',
          'head condition':'seated','completed screw turns':0},
         {'root drive key':False},'4 mm hex key','tools',['simultaneous two-key transfer and withdrawal'])
    pair('lift ball2.1mm into nut register with other hand while maintaining AF3 push',
         {'root phase':'turned','root drive key':False,'M4 key':True,'collar support':'AF3 push',
          'head condition':'seated','completed screw turns':0},
         {'root phase':'registered'},'hand','root',['continuous2.1mm seating and reverse; upper stop and seated head'])
    for turn in range(3):
        pair(f'AF3 screw full turn{turn+1}; other hand follows ball to PTFE',
             {'root phase':'registered','root drive key':False,'M4 key':True,'collar support':'AF3 push',
              'head condition':'seated','completed screw turns':turn},
             {'completed screw turns':turn+1},'3 mm hex key','tools',
             ['full RH3turn thread stroke; positive nut register and head seat; ball axial motion'])
    pair('withdraw AF3 after clamp and accept fully locked rotor',
         {n:'inserted' for n in actors}|{'root phase':'registered','root drive key':False,'M4 key':True,
           'collar support':'AF3 push','head condition':'seated','completed screw turns':3},
         {n:'secured' for n in actors}|{'root phase':'locked','M4 key':False,'collar support':'clamped'},
         '3 mm hex key','tools',['AF3 complete withdrawal; clamp seats carry load'])

def negative_controls(model,inventory):
    controls={}
    def reject(name,mutate,inventory_override=None):
        broken=deepcopy(model);mutate(broken)
        try:verify_inventory(broken,inventory if inventory_override is None else inventory_override)
        except Violation as error:controls[name]=str(error)
        else:raise AssertionError('Actual candidate mutation admitted: '+name)
    actor=next(n for n,q in inventory.items() if q['role']=='hardware')
    reject('preinstalled hardware',lambda m:m['parts'][actor].update(initial='inserted'))
    reject('missing final unlock',lambda m:m['actions'].pop())
    reject('above-root side access',lambda m:m['actions'][0].update(access='side-above-root'))
    reject('custom fork',lambda m:m['actions'][0].update(tool='custom fork'))
    reject('omitted hardware',lambda m:(m['parts'].pop(actor),m['modules']['detachable module'].remove(actor)))
    return controls


def write(concept,receipt_path,evidence,output,evidence_root=None):
    model,inventory=build(concept,json.loads(receipt_path.read_text()),evidence)
    if model.get('pending_C_force_transfer_refinement'):raise Violation('C force-transfer protocol is not yet admitted')
    result=verify_inventory(model,inventory);verify_evidence(model,evidence_root or output)
    controls=negative_controls(model,inventory)
    (output/'protocol.json').write_text(json.dumps(model,indent=2)+'\n')
    (output/'lifecycle.json').write_text(json.dumps(dict(result=asdict(result),negative_controls=controls,
        inventory=inventory,physical_fit_verified=False,scope=model['scope']),indent=2)+'\n')
    return result
