"""Independent exact17-actor protocol for the integrated-cover C variant."""
from __future__ import annotations
from copy import deepcopy
from candidate_protocol import c_root,negative_controls
from post_glue_lifecycle import verify_inventory,verify_evidence,Violation
LOCK='removable lock and driver half A'
FUSED='integrated half B and capture cover'


def inventory():
    roles={'removable padded knob cup':'printed',LOCK:'printed',FUSED:'printed'}
    for sign in ('-1','+1'):
        for suffix,role in [('retained padded shoe','printed'),('cut-stock adhesive-backed pad envelope','pad'),('preset set-screw envelope','hardware'),('captive nut envelope','hardware')]:roles[sign+' '+suffix]=role
    for angle in (130.,200.):
        for prefix in ('external cover M3x8 screw ','external cover M3 nut '):roles[prefix+str(angle)]='hardware'
    for prefix in ('axial M4x12 socket screw ','threaded M4 full nut '):roles[prefix+'110.0']='hardware'
    assert len(roles)==17
    return {name:dict(role=role,module='detachable module') for name,role in roles.items()}


def build(receipt,evidence):
    expected=inventory();actors=sorted(expected)
    actual={p['name']:{'print':'printed','pad':'pad','hardware':'hardware'}[p['role']] for p in receipt['stages']['inserted']['components']}
    if receipt.get('variant')!='reduced-cover-B' or actual!={n:r['role'] for n,r in expected.items()}:raise Violation('Reduced C actual inventory differs')
    model=dict(schema=1,concept='C',variant='reduced-cover-B',bar_already_glued=True,above_root_exterior_access=False,
        environment=['bare C456 bar is permanently glued; no preinstalled coupling hardware','ordinary flat bench supports cup root-positive-up during external partial assembly; gravity seats the uncapped M4 head','stock knob/hex fixed to box before assembled module is mounted; ordinary bench support180mm for underside service'],
        scope='Exhaustive instructed17-actor discrete assembly and reversal; actual continuous geometry and tools separate; physical forces/fit unverified',parts={n:dict(initial='outside',final='secured',role=r['role']) for n,r in expected.items()},modules={'detachable module':actors},variables={},actions=[],evidence=evidence)
    def variable(name,domain,initial,final):model['variables'][name]=dict(domain=domain,initial=initial,final=final,owners=['detachable module'])
    def pair(name,requires,sets,tool,category,checks,external=False,reverse_name=None):
        before=requires.copy();after=requires|sets
        common=dict(tool=tool,access='external-module' if external else 'root',geometry_evidence=category,evidence_checks=checks,operator_hands_max=2,bar_glue_unchanged=True)
        if external:
            before.update({n:'outside' for n in actors});after.update({n:'outside' for n in actors})
            safe={'root drive key':False,'M4 key':False,'root phase':'outside'};before.update(safe);after.update(safe);common['external_parts']=actors
        model['actions'].extend([dict(id=name,requires=before,sets=sets,**common),dict(id=reverse_name or 'reverse: '+name,requires=after,sets={n:before[n] for n in sets},**common)])
    steps=[]
    for sign in ('-1','+1'):
        steps.extend([(sign+' pad attachment and peel reverse','hand'),(sign+' shoe axial entry and reverse','hand'),(sign+' shoe radial seating and reverse','hand'),(sign+' grip nut entry and reverse','hand'),(sign+' preset set-screw envelope external thread-on and reverse','1.5 mm hex key')])
    for angle in (130.,200.):steps.append((f'cover nut {angle} entry and reverse','hand'))
    steps.extend([('threaded M4 full nut 110.0 external thread-on and reverse','hand'),('axial M4x12 socket screw 110.0 external axial entry and reverse','hand'),('A lock driver half with preloaded M4 and nuts radial entry and reverse','hand'),('uncapped M4 head seating and retained threaded pair','3 mm hex key'),('integrated B cover assembly and reverse over fixed A driver','hand')])
    for angle in (130.,200.):steps.append((f'external cover M3x8 screw {angle} axial installation and reverse','2 mm hex key'))
    variable('outside assembly',list(range(len(steps)+1)),0,len(steps));variable('on OEM knob',[False,True],False,True);variable('grip',[False,True],False,True);variable('root phase',['outside','entered','turned','registered','locked'],'outside','locked')
    for i,(name,tool) in enumerate(steps):
        checks=[name]
        if name.startswith('external cover M3x8 screw '):
            prefix=name.removesuffix(' axial installation and reverse');checks += [prefix+' full AF2 tool '+p for p in ('entry','operation','withdrawal')]
        pair(name,{'outside assembly':i,'on OEM knob':False,'grip':False},{'outside assembly':i+1},tool,'external',checks,external=True)
    pair('lower complete released module over knob',{'outside assembly':len(steps),'on OEM knob':False,'grip':False},{'on OEM knob':True},'hand','module',['continuous knob entry and box withdrawal'],external=True)
    pair('tighten two padded grip screws with ordinary AF1.5 key',{'outside assembly':len(steps),'on OEM knob':True,'grip':False},{'grip':True},'1.5 mm hex key','external',[s+' grip key '+p for s in ('-1','+1') for p in ('entry','operation','withdrawal')],external=True)
    c_root(actors,pair,variable)
    return model,expected
