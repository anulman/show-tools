"""Serial ordinary keys; one hand holds the ball throughout unclamped service."""
from __future__ import annotations
from collections import deque
from copy import deepcopy
import reduced_c_protocol as reduced
from post_glue_lifecycle import verify_inventory,require,Violation,MAX_STATES


def build(receipt,evidence):
    model,inventory=reduced.build(receipt,evidence);actors=sorted(inventory)
    model['variant']='air-gap-C-serial-service'
    model['environment']=['bare original bar already glued; all17 coupling actors initially outside','unchanged stock knob/hex fixed on the new air-gap box; actual placement and clearance require combined admission','ordinary flat bench supports the cup during external partial assembly only','box may be raised180mm on ordinary bench blocks for underside access; one hand holds the ball during every unclamped root operation','no PTFE, base contact, temporary ball rest, packing strip or simultaneous keys']
    model['scope']='New air-gap serial-key transition system; unchanged actual17-actor C geometry; continuous recovery and combined base evidence separate; physical load/fit/hand reach unverified'
    model['actions']=[a for a in model['actions'] if a['access']=='external-module']
    model['variables']={n:q for n,q in model['variables'].items() if n in {'outside assembly','on OEM knob','grip','root phase'}}
    def variable(name,domain,initial,final):model['variables'][name]=dict(domain=domain,initial=initial,final=final,owners=['detachable module'])
    def pair(name,before,sets,tool,category,checks,motion):
        common=dict(tool=tool,access='root',geometry_evidence=category,evidence_checks=checks,operator_hands_max=2,bar_glue_unchanged=True,airgap_motion=motion)
        model['actions'].extend([dict(id=name,requires=before,sets=sets,**common),dict(id='reverse: '+name,requires=before|sets,sets={n:before[n] for n in sets},**common)])
    variable('root drive key',[False,True],False,False);variable('M4 key',[False,True],False,False)
    variable('collar support',['loose','AF4 push','AF3 push','clamped'],'loose','clamped')
    variable('head condition',['captured float permitted','seated'],'captured float permitted','seated')
    variable('completed screw turns',[0,1,2,3],0,3)
    variable('ball support',['off module','hand','clamped'],'off module','clamped')
    outside={n:'outside' for n in actors};inserted={n:'inserted' for n in actors}
    pair('engage AF4 before ball entry and recover upper stop',outside|{'root phase':'outside','on OEM knob':True,'grip':True,'root drive key':False,'M4 key':False,'collar support':'loose','head condition':'captured float permitted','completed screw turns':0,'ball support':'off module'},{'root drive key':True,'collar support':'AF4 push'},'4 mm hex key','serial-service',['inserted AF4 serial recovery'],'key-recovery')
    pair('hold and lower glued ball50mm while AF4 maintains upper stop',outside|{'root phase':'outside','root drive key':True,'M4 key':False,'collar support':'AF4 push','completed screw turns':0,'ball support':'off module'},{**inserted,'root phase':'entered','ball support':'hand'},'hand','root',['fixed cup and collar complete50mm axial insertion and reverse; upper stop held'],'ball-entry')
    pair('turn collar35degrees with AF4 push and other hand holding ball',{'root phase':'entered','root drive key':True,'M4 key':False,'collar support':'AF4 push','completed screw turns':0,'ball support':'hand'},{'root phase':'turned'},'4 mm hex key','root',['continuous35 degree turn at delta=-0.5 including captured head float0..0.5'],'collar-turn')
    for phase in ('entered','turned'):
        pair('release AF4 push with ball held at '+phase,{'root phase':phase,'root drive key':True,'M4 key':False,'collar support':'AF4 push','head condition':'captured float permitted','completed screw turns':0,'ball support':'hand'},{'collar support':'loose'},'4 mm hex key','race',['continuous collar race and captured head float; recover upper stop by bottomed key'],'release-push')
        pair('withdraw AF4 completely with ball held at '+phase,{'root phase':phase,'root drive key':True,'M4 key':False,'collar support':'loose','head condition':'captured float permitted','completed screw turns':0,'ball support':'hand'},{'root drive key':False},'4 mm hex key','serial-service',[('inserted' if phase=='entered' else 'turned')+' AF4 serial recovery'],'key-exchange')
    pair('recover floating AF3 head and collar upper stop with ball held',{'root phase':'turned','root drive key':False,'M4 key':False,'collar support':'loose','head condition':'captured float permitted','completed screw turns':0,'ball support':'hand'},{'M4 key':True,'collar support':'AF3 push','head condition':'seated'},'3 mm hex key','serial-service',['turned AF3 serial recovery'],'key-recovery')
    pair('hand lift ball2.1mm into register with AF3 upper-stop push',{'root phase':'turned','root drive key':False,'M4 key':True,'collar support':'AF3 push','head condition':'seated','completed screw turns':0,'ball support':'hand'},{'root phase':'registered'},'hand','root',['continuous2.1mm seating and reverse; upper stop and seated head'],'register-stroke')
    for turn in range(3):
        pair(f'AF3 full turn{turn+1} with other hand following ball axial stroke',{'root phase':'registered','root drive key':False,'M4 key':True,'collar support':'AF3 push','head condition':'seated','completed screw turns':turn,'ball support':'hand'},{'completed screw turns':turn+1},'3 mm hex key','tools',['full RH3turn thread stroke; positive nut register and head seat; ball axial motion'],'thread-stroke')
    pair('withdraw AF3 after clamp; release ball hand only when secured',inserted|{'root phase':'registered','root drive key':False,'M4 key':True,'collar support':'AF3 push','head condition':'seated','completed screw turns':3,'ball support':'hand'},{**{n:'secured' for n in actors},'root phase':'locked','M4 key':False,'collar support':'clamped','ball support':'clamped'},'3 mm hex key','tools',['AF3 complete withdrawal; clamp seats carry load'],'clamp-handoff')
    return model,inventory


def verify(model,inventory):
    result=verify_inventory(model,inventory)
    require(set(model['variables']['ball support']['domain'])=={'off module','hand','clamped'},'PTFE/base rest is forbidden in air-gap service')
    for action in model['actions']:
        if action.get('airgap_motion')=='key-recovery' and action['sets'].get('M4 key') is True:
            require(action['sets'].get('head condition')=='seated' and action['sets'].get('collar support')=='AF3 push','AF3 recovery omits head seat or collar stop')
    # Exhaustively check physical hand/stop invariants as well as removability.
    initial={n:q['initial'] for n,q in model['parts'].items()}|{n:q['initial'] for n,q in model['variables'].items()}
    names=sorted(initial);key=lambda s:tuple(s[n] for n in names)
    reached={key(initial)};queue=deque([initial])
    while queue:
        state=queue.popleft()
        require(not(state['root drive key'] and state['M4 key']),'Air-gap service requires simultaneous keys and a third hand')
        if state['root phase'] in ('entered','turned','registered'):require(state['ball support']=='hand','Unclamped air-gap ball lacks its holding hand')
        require(state['root phase']!='locked' or state['ball support']=='clamped','Locked ball support differs')
        for action in model['actions']:
            if not all(state[n]==v for n,v in action['requires'].items()):continue
            motion=action.get('airgap_motion')
            if motion=='collar-turn':require(state['collar support']=='AF4 push' and state['root drive key'] and not state['M4 key'],'Collar turn with released race or wrong tool')
            if motion in ('register-stroke','thread-stroke'):require(state['collar support']=='AF3 push' and state['M4 key'] and not state['root drive key'] and state['head condition']=='seated','Seat/clamp without head and collar recovery')
            target=state|action['sets'];encoded=key(target)
            if encoded not in reached:
                require(len(reached)<MAX_STATES,'Air-gap invariant bound exceeded');reached.add(encoded);queue.append(target)
    require(len(reached)==result.reachable_states,'Air-gap invariant enumeration differs')
    return result


def negative_controls(model,inventory):
    controls=reduced.negative_controls(model,inventory)
    def reject(name,mutate):
        broken=deepcopy(model);mutate(broken)
        try:verify(broken,inventory)
        except Violation as error:controls[name]=str(error)
        else:raise AssertionError('Air-gap protocol mutant admitted: '+name)
    def exchange_third_hand(m):
        action=next(a for a in m['actions'] if a['id']=='recover floating AF3 head and collar upper stop with ball held');action['requires'].pop('root drive key')
    reject('simultaneous keys require third hand',exchange_third_hand)
    def no_ball_hand(m):
        action=next(a for a in m['actions'] if a.get('airgap_motion')=='ball-entry');action['sets']['ball support']='off module'
    reject('unsupported air-gap ball',no_ball_hand)
    def loose_turn(m):
        action=next(a for a in m['actions'] if a.get('airgap_motion')=='collar-turn');action['requires'].pop('collar support')
    reject('turn before upper-stop recovery',loose_turn)
    def old_rest(m):
        m['variables']['ball support']['domain'].append('PTFE rest')
        action=next(a for a in m['actions'] if a['id']=='recover floating AF3 head and collar upper stop with ball held');action['sets']['ball support']='PTFE rest';action['requires']['ball support']='hand'
    reject('reuse old PTFE ball rest',old_rest)
    def omit_head(m):
        action=next(a for a in m['actions'] if a['id']=='recover floating AF3 head and collar upper stop with ball held');action['sets']['head condition']='captured float permitted'
    reject('omit AF3 head recovery',omit_head)
    return controls
