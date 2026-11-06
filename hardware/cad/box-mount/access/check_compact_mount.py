"""Exercise complete compact configurations and failures using actual C2 exports."""
import argparse
from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
import compact_mount as c


def reject(action,reason):
    try:action()
    except ValueError as error:assert reason in str(error),str(error)
    else:raise AssertionError('Invalid compact mount accepted: '+reason)


def changed(candidate,**parts):
    return dict(candidate,parts=dict(candidate['parts'],**parts))


parser=argparse.ArgumentParser(description=__doc__)
for name in ('collar-receipt','grip-receipt','baseline-receipt','hex-receipt','source-worktree'):
    parser.add_argument('--'+name,type=Path,required=True)
args=parser.parse_args()
with tempfile.TemporaryDirectory(prefix='compact-mount-negatives-') as directory:
    root=Path(directory);receipt=root/'changed.json'
    producer=json.loads(args.collar_receipt.read_bytes());del producer['source_code_sha256']['standard_collar.py']
    receipt.write_text(json.dumps(producer))
    reject(lambda:c.prepare(receipt,args.grip_receipt,args.baseline_receipt,args.hex_receipt,args.source_worktree),'Incomplete C2 source inventory')
    producer=json.loads(args.grip_receipt.read_bytes());producer['access_components'].pop()
    receipt.write_text(json.dumps(producer))
    reject(lambda:c.prepare(args.collar_receipt,receipt,args.baseline_receipt,args.hex_receipt,args.source_worktree),'Incomplete grip tool inventory')
    data=c.prepare(args.collar_receipt,args.grip_receipt,args.baseline_receipt,args.hex_receipt,args.source_worktree)
    checks=c.verify(data);candidate=data['candidate'];parts=candidate['parts'];raised=c.configuration(candidate,7.)
    assert len(checks['5']['states'])==6 and len(checks['7']['states'])==6
    assert checks['5']['tabletop']['minimum_lifted_table_clearance_mm']>5
    assert checks['7']['buffer']['total_screw_length_including_head_mm']==12
    tools=[(name,c.audit.pose(part,5,c.INDEX)) for name,part in data['controls']]
    reject(lambda:c.tabletop_check(candidate,tools,100),'Compact whole tool staging hits lifted table')
    # Restoring the old solid roof blocks actual moving collar geometry.
    solid_roof=parts['shell']+c.cad.ring(32.5,44,10,-10)
    drive=c.audit.pose(dict(data['states']['locked'])['standard-screw drive collar'],5,c.INDEX)
    assert c.audit.intersection(drive,solid_roof)>1
    reject(lambda:c.previous.clear([('collar',drive)],dict(c.obstacles(candidate),shell=solid_roof),'No annular well'),'No annular well blocked')
    reject(lambda:c.invariant_check(data,changed(candidate,shell=solid_roof)),'Fixed part escapes compact invariant bounds')
    # Remove actual material from the support below the race.
    cut=c.r.block(1,1,1,(0,38.5,-16));roof=parts['shell']-cut
    assert c.audit.volume(parts['shell']-roof)>.9
    reject(lambda:c.verify_lower_web(changed(candidate,shell=roof)),'Missing lower radial support web')
    # A missing nose must fail the physical lift check even if every cached tab agrees.
    tab=parts['keeper_tab_1'];no_nose=tab-c.r.block(8,2,.25,(0,16.5,-.25))
    assert c.audit.volume(tab-no_nose)>3.9
    wrong=changed(candidate,keeper_tab_1=no_nose)
    wrong['keepers']=dict(candidate['keepers'],tabs=[candidate['keepers']['tabs'][0],no_nose])
    reject(lambda:c.verify_hex_capture(wrong),'Measured keeper has hidden axial play')
    # A cap across the extended loading channel blocks the real maximum nut sweep.
    cap=c.r.block(8,8,1,(0,28,-18))-c.r.bore(0,28,-18.1,-16.9)
    reject(lambda:c.r.verify_nut_loading([candidate['keepers']['pairs'][1]],parts['shell']+cap),'Nut loading path blocked')
    thin=c.cad.ring(44,57,1)
    for j in candidate['kit']['pairs']:thin-=c.r.bore(*j.expected_xy,-1,3)
    reject(lambda:c.verify_shim(candidate,changed(raised,height_shim=thin)),'Shim changes full g7 support material')
    j=raised['kit']['pairs'][0];x,y=j.expected_xy
    short=replace(j,length=10,screw=c.base.buffer_cad.flat_screw(x,y,j.length_datum_z,10))
    body=raised['parts']['shell']+raised['parts']['spacer']+raised['parts']['buffer']+raised['parts']['height_shim']
    reject(lambda:c.r.check_joint(short,body),'Insufficient nominal thread reach')
    # The cup blocks keeper access after installation; the bar blocks grip access.
    cup=c.audit.pose(dict(data['review'])['preset / knob baseplate cup'],5,c.INDEX)
    shaft=c.cad.cyl(1.2,100,2.8).translate((0,28,0))
    assert c.audit.intersection(cup,shaft)>1
    bar=c.audit.pose(dict(data['review'])['full-height bar'],5,c.INDEX)
    key=c.audit.pose(data['grip_tools'][0][1],5,c.INDEX)
    assert c.audit.intersection(key,bar)>1
    # A changed receipt cannot leave a stale success artifact.
    raw=args.collar_receipt.read_bytes();receipt.write_bytes(raw)
    snapshots=dict(data['snapshots'],collar=c.ear.ReceiptSnapshot.capture(receipt))
    wrong=dict(data,snapshots=snapshots);receipt.write_bytes(raw+b' ')
    output=root/'output';output.mkdir();(output/'receipt.json').write_text('stale')
    reject(lambda:c.export(wrong,output),'Base source receipt changed')
    assert not (output/'receipt.json').exists()
print('PASS: g5/g7 full C2/keys/assembly B/contact/hardware and exact source coupons; old roof, missing web/nose, capped loading, thin shim, short screw, insufficient lift, omitted source/tool and changed receipt rejected')
