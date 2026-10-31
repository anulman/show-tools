"""Panel service requires two free hands: ball off the module or clamped."""
from __future__ import annotations
from collections import deque
import hashlib,json
from post_glue_lifecycle import require,MAX_STATES
import airgap_c_protocol

OPEN='remove four cover screws and bottom; wiring stays fixed'
CLOSE='refit bottom and four cover screws; ball off module or clamped and both keys withdrawn'


def endpoints(model):
    names=tuple(sorted(set(model['parts'])|set(model['variables'])))
    def endpoint(which):
        return tuple(model['parts'][n][which] if n in model['parts'] else model['variables'][n][which] for n in names)
    return names,endpoint('initial'),endpoint('final')


def panel_safe(values):
    return not(values['root drive key'] or values['M4 key']) and values['ball support'] in ('off module','clamped')


def product(model,require_open=True,require_keys_out=True,require_ball_supported=True,
            can_open=True,can_close=True,enforce_hand_invariant=True):
    names,start,end=endpoints(model);initial=(start,True);final=(end,True)
    reached={initial:None};queue=deque([initial]);reverse={};edges=[]
    while queue:
        state=queue.popleft();coupling,present=state;values=dict(zip(names,coupling))
        keys=values['root drive key'] or values['M4 key']
        require(not(present and keys),'Air-gap key behind closed bottom')
        if enforce_hand_invariant:require(not(present and values['ball support']=='hand'),'Hand-supported air-gap ball behind closed bottom')
        following=[]
        for action in model['actions']:
            if not all(values[n]==v for n,v in action['requires'].items()):continue
            if action['access']=='root' and present:
                if require_open:continue
                raise ValueError('Installed air-gap root action enabled with bottom closed')
            updated=values|action['sets']
            following.append(((tuple(updated[n] for n in names),present),action['id']))
        if (not require_keys_out or not keys) and (not require_ball_supported or values['ball support'] in ('off module','clamped')):
            if present and can_open:following.append(((coupling,False),OPEN))
            if not present and can_close:following.append(((coupling,True),CLOSE))
        for target,action in following:
            edges.append((state,target,action));reverse.setdefault(target,[]).append((state,action))
            if target not in reached:
                require(len(reached)<MAX_STATES,'Air-gap panel product state limit exceeded')
                reached[target]=(state,action);queue.append(target)
    require(final in reached,'No assembled air-gap state with closed panel')
    toward_initial={initial:None};queue=deque([initial])
    while queue:
        state=queue.popleft()
        for previous,action in reverse.get(state,[]):
            if previous not in toward_initial:toward_initial[previous]=(state,action);queue.append(previous)
    require(set(reached)<=set(toward_initial),'Air-gap panel state has no complete reversal')
    def trace(target):
        result=[]
        while target!=initial:
            previous,action=reached[target];result.append(action);target=previous
        return list(reversed(result))
    removal=[];state=final
    while state!=initial:state,action=toward_initial[state];removal.append(action)
    ordered=sorted(reached,key=lambda s:json.dumps(s));indices={s:i for i,s in enumerate(ordered)}
    serialized=dict(states=ordered,edges=sorted((indices[a],indices[b],action) for a,b,action in edges))
    summaries=[dict(id=indices[s],bottom_present=s[1],**{n:dict(zip(names,s[0]))[n] for n in
               ('root phase','root drive key','M4 key','completed screw turns','ball support')}) for s in ordered]
    unsafe={}
    for source,target,action in edges:
        values=dict(zip(names,source[0]))
        if action==CLOSE and values['ball support']=='hand':
            unsafe.setdefault(values['root phase'],dict(state={n:values[n] for n in ('root phase','ball support','root drive key','M4 key')},trace=trace(source)+[action]))
    return dict(reachable_states=len(reached),C_projection_states=len({s[0] for s in reached}),transitions=len(edges),
                every_reachable_state_returns_to_bare_glued_bar_and_closed_box=True,initial_and_final_panel_closed=True,
                all_installed_C_actions_require_bottom_open=True,panel_changes_require_both_C_keys_withdrawn=True,
                panel_changes_require_ball_off_module_or_clamped=True,closed_panel_with_hand_supported_ball_forbidden=True,
                panel_changes_require_ball_hand_free=True,
                assembly_trace=trace(final),removal_trace=removal,reachable_state_summary=summaries,
                graph_sha256=hashlib.sha256(json.dumps(serialized,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
                unsafe_hand_supported_panel_witnesses=unsafe,
                scope='Exact air-gap coupling/panel product with explicit ball-support and two-free-hand guards'),serialized


def oracle(model):
    """Independent Cartesian graph and transitive closure, without product BFS."""
    names,initial,final=endpoints(model)
    coupling={initial};pending=[initial];coupling_edges=[]
    while pending:
        source=pending.pop();values=dict(zip(names,source))
        for action in model['actions']:
            if not all(values[n]==v for n,v in action['requires'].items()):continue
            changed=values|action['sets'];target=tuple(changed[n] for n in names)
            coupling_edges.append((source,target,action))
            if target not in coupling:coupling.add(target);pending.append(target)
    states={(s,present) for s in coupling for present in (False,True)
            if not present or panel_safe(dict(zip(names,s)))}
    edges=set()
    for source,target,action in coupling_edges:
        for present in (False,True):
            if present and action['access']=='root':continue
            a,b=(source,present),(target,present)
            if a in states and b in states:edges.add((a,b,action['id']))
    for state in coupling:
        if panel_safe(dict(zip(names,state))):
            edges.update({((state,True),(state,False),OPEN),((state,False),(state,True),CLOSE)})
    closure={s:{s} for s in states}
    for a,b,_ in edges:closure[a].add(b)
    for middle in states:
        for source in states:
            if middle in closure[source]:closure[source]|=closure[middle]
    reached=closure[(initial,True)]
    require((final,True) in reached and all((initial,True) in closure[s] for s in reached),'Independent panel closure/reversal failed')
    ordered=sorted(reached,key=lambda s:json.dumps(s));indices={s:i for i,s in enumerate(ordered)}
    return dict(states=ordered,edges=sorted((indices[a],indices[b],action) for a,b,action in edges if a in reached and b in reached))


def verify(admitted):
    model=admitted['model'];result,graph=product(model)
    require(graph==oracle(model),'Panel product disagrees with independent transitive-closure oracle')
    require(result['C_projection_states']==admitted['lifecycle']['reachable_states'],'Panel product omits coupling states')
    controls=airgap_c_protocol.negative_controls(model,admitted['inventory'])
    for name,options in (
        ('bottom-off root guard removed',dict(require_open=False)),
        ('keys-out panel guard removed',dict(require_keys_out=False)),
        ('ball-support panel guard removed',dict(require_ball_supported=False)),
        ('panel opening removed',dict(can_open=False)),('panel refit removed',dict(can_close=False))):
        try:product(model,**options)
        except ValueError as error:controls[name]=str(error)
        else:raise AssertionError('Unsafe air-gap panel product admitted: '+name)
    unsafe,_=product(model,require_ball_supported=False,enforce_hand_invariant=False)
    witnesses=unsafe['unsafe_hand_supported_panel_witnesses']
    require(set(witnesses)=={'entered','turned'},'Missing actual hand-supported panel counterexamples')
    require(not result['unsafe_hand_supported_panel_witnesses'],'Positive panel model enables unsupported panel refit')
    result.update(C_protocol_model_sha256=admitted['model_sha256'],negative_controls=controls,
                  independent_cartesian_transitive_closure_oracle_agrees=True,
                  hand_guard_removed_counterexamples=witnesses,
                  panel_is_exterior_box_environment_not_a_new_ball_coupling_actor=True)
    return result
