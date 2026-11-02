"""Eight removable actors installed after the integral bar is glued; intrinsic only."""
from copy import deepcopy
from collections import deque
from post_glue_lifecycle import verify_inventory,verify_evidence,require,Violation
from candidate_protocol import negative_controls as original_controls


def inventory():
    return {s+' '+n:dict(role=r,module='detachable module') for s in ('-1','+1') for n,r in [('retained padded shoe','printed'),('cut-stock adhesive-backed pad envelope','pad'),('preset set-screw envelope','hardware'),('captive nut envelope','hardware')]}


def build(concept,evidence):
    expected=inventory();actual={r['name']:{'print':'printed','pad':'pad','hardware':'hardware'}[r['role']] for r in concept['components'][1:]}
    require(actual=={n:r['role'] for n,r in expected.items()},'Integral grip does not have exact8 detachable actors')
    actors=sorted(expected);model=dict(schema=1,concept='integral exposed opposed-shoe grip',bar_already_glued=True,above_root_exterior_access=False,environment=['complete integral bar/foot already glued inside ball; no hidden receiver or preinstalled nut','all work uses exposed positive-source-Z mouth and opposed side ports below original opening','hold ball with one hand during both sequential side-key operations; actual grip/load/hand reach unverified','off-spindle loose-part work uses operator support; no installed box geometry or support stand is assumed'],scope='Intrinsic instructed8actor post-glue lifecycle only; base, physical fit, force and installed rotation require separate evidence',parts={n:dict(initial='outside',final='secured',role=r['role']) for n,r in expected.items()},modules={'detachable module':actors},variables={},actions=[],evidence=evidence)
    def var(n,domain,first,last):model['variables'][n]=dict(domain=domain,initial=first,final=last,owners=['detachable module'])
    var('progress',list(range(17)),0,16);var('on OEM knob',[False,True],False,True);var('ball support',['off spindle','hand','gripped'],'off spindle','gripped')
    for s in ('-1','+1'):var('grip '+s,[False,True],False,True)
    state={n:q['initial'] for n,q in model['parts'].items()}|{n:q['initial'] for n,q in model['variables'].items()};i=0
    def pair(name,changes,tool,checks,external=False):
        nonlocal i,state
        before={'progress':i,**{n:state[n] for n in changes}};sets={'progress':i+1,**changes}
        before.update({'on OEM knob':state['on OEM knob'],'ball support':state['ball support']})
        common=dict(tool=tool,access='external-module' if external else 'root',geometry_evidence='intrinsic',evidence_checks=checks,operator_hands_max=2,bar_glue_unchanged=True,service_side_below_original_opening=True)
        if external:before.update({n:'outside' for n in actors});common['external_parts']=actors
        model['actions'] += [dict(id=name,requires=before,sets=sets,**common),dict(id='reverse: '+name,requires=before|sets,sets={n:before[n] for n in sets},**common)]
        state|=sets;i+=1
    for s in ('-1','+1'):pair(s+' bond cut pad to shoe before installation',{},'hand',[s+' pad backing and nominal bond seat'],True)
    for s in ('-1','+1'):
        nut=s+' captive nut envelope';shoe=s+' retained padded shoe';pad=s+' cut-stock adhesive-backed pad envelope';screw=s+' preset set-screw envelope'
        pair(s+' feed nut through exposed mouth',{nut:'inserted'},'hand',[s+' nut axial feed'])
        pair(s+' seat nut in side pocket',{nut:'secured'},'hand',[s+' nut radial feed and retained reactions'])
        pair(s+' feed inward shoe and bonded pad through exposed mouth',{shoe:'inserted',pad:'inserted'},'hand',[s+' released shoe and pad axial feed'])
        pair(s+' seat released shoe and bonded pad',{shoe:'secured',pad:'secured'},'hand',[s+' released shoe and pad radial seat'])
        pair(s+' thread released screw from exposed side',{screw:'secured'},'1.5 mm hex key',[s+' screw radial feed',s+' whole side key'])
    pair('lower complete integral ball grip over nominal knob while holding ball',{'on OEM knob':True,'ball support':'hand'},'hand',['released whole module knob entry and reverse'])
    for s in ('-1','+1'):pair(s+' tighten screw0.4nominalturn while other hand holds ball',{'grip '+s:True},'1.5 mm hex key',[s+' released to preset0p2 stroke',s+' whole side key'])
    pair('release holding hand only after both grips set',{'ball support':'gripped'},'hand',['both pads and screw reaction chain'])
    require(i==16,'Integral protocol progress count changed')
    return model,expected


def verify(model,inventory):
    result=verify_inventory(model,inventory);names=sorted(set(model['parts'])|set(model['variables']))
    initial={n:r['initial'] for n,r in model['parts'].items()}|{n:r['initial'] for n,r in model['variables'].items()};encode=lambda s:tuple(s[n] for n in names)
    reached={encode(initial)};queue=deque([initial])
    while queue:
        s=queue.popleft()
        if s['on OEM knob'] and not(s['grip -1'] and s['grip +1']):require(s['ball support']=='hand','Ball unsupported before both side grips are set')
        if s['ball support']=='gripped':require(s['on OEM knob'] and s['grip -1'] and s['grip +1'],'Holding hand released before both grips')
        for a in model['actions']:
            if not all(s[n]==v for n,v in a['requires'].items()):continue
            target=s|a['sets'];key=encode(target)
            if key not in reached:reached.add(key);queue.append(target)
    require(len(reached)==result.reachable_states,'Integral hand invariant graph differs')
    return result


def controls(model,inventory):
    result=original_controls(model,inventory)
    m=deepcopy(model);a=next(a for a in m['actions'] if a['id']=='lower complete integral ball grip over nominal knob while holding ball');a['sets']['ball support']='off spindle'
    try:verify(m,inventory)
    except Violation as e:result['omit holding hand']=str(e)
    else:raise AssertionError('Unsupported integral ball admitted')
    return result


def write(concept_path,service_path,output):
    import json,hashlib,shutil,sys
    import post_glue_lifecycle as life
    import candidate_protocol
    import publication_bundle
    from pathlib import Path
    from dataclasses import asdict
    if output.exists():raise ValueError('Use a fresh intrinsic protocol namespace')
    concept=json.loads(concept_path.read_text());service=json.loads(service_path.read_text())
    digest=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
    require(service['source_concept_sha256']==digest(concept_path) and service['actual_subjects_reimport_unchanged'] is True and service['all_actor_paths_continuous'] is True,'Wrong intrinsic service evidence')
    for path,sha in service['input_files'].items():require(digest(path)==sha,'Changed intrinsic evidence input: '+path)
    publication_bundle.check_bound_paths(service)
    output.mkdir(parents=True);(output/'proofs').mkdir();proof=output/'proofs/intrinsic.json';shutil.copyfile(service_path,proof)
    model,actors=build(concept,{'intrinsic':dict(path='proofs/intrinsic.json',sha256=digest(proof))})
    ids={r['id'] for r in service['evidence']}
    for a in model['actions']:require(set(a['evidence_checks'])<=ids,'Intrinsic action lacks checked geometry: '+a['id'])
    result=verify(model,actors);verify_evidence(model,output);negative=controls(model,actors)
    path=output/'protocol.json';path.write_text(json.dumps(model,indent=2)+'\n')
    report=dict(scope='INTRINSIC8ACTOR_PROTOCOL_ONLY_NOT_BASE_OR_PRINT_ADMISSION',concept=dict(path=str(concept_path.resolve()),sha256=digest(concept_path)),protocol=dict(path=str(path.resolve()),sha256=digest(path)),result=asdict(result),inventory=actors,negative_controls=negative,checker_sources={str(Path(module.__file__).resolve()):digest(module.__file__) for module in (sys.modules[__name__],life,candidate_protocol,publication_bundle)},actual_base_clearance_verified=False,physical_fit_verified=False,manufacturing_approved=False)
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(output/'receipt.json')


if __name__=='__main__':
    import argparse
    from pathlib import Path
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('concept','service','output'):p.add_argument('--'+n,type=Path,required=True)
    q=p.parse_args();write(q.concept,q.service,q.output)
