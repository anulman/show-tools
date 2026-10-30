"""Check analytic rotary/base admission and reject angle-sampling/tool-binding mistakes."""
import argparse
import tempfile
from unittest.mock import patch
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import post_glue_base_gate as g
import check_post_glue_candidate_base as candidate
from build123d import Axis


def reject(action,reason):
    try:action()
    except ValueError as error:assert reason in str(error),str(error)
    else:raise AssertionError('Invalid post-glue base evidence accepted: '+reason)


parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-receipt',type=Path,required=True)
parser.add_argument('--source-worktree',type=Path,required=True)
args=parser.parse_args();data=g.load_base(args.base_receipt);report=g.reference_report(data,args.source_worktree)
assert report['new_candidate_lifecycle_status']=='NOT_EVALUATED'
assert report['old_C2_lifecycle_status'].startswith('REJECTED')
fixture=g.r.block(1,1,1,(38,0,-10))
# An asymmetric cup distinguishes whole-module A/B rotation from C's collar-only rotation.
pose=dict(angle=35.,shift=2.)
for concept in ('post-glue A','post-glue B','post-glue C'):
    sources,rotates=candidate.concept_rules(concept)
    assert len(sources)==(9 if concept=='post-glue C' else 8)
    assert ('post_glue_cassette.py' in sources)==(concept=='post-glue C')
    exported=fixture.rotate(Axis.Z,pose['angle'] if rotates else 0.).translate((0,0,pose['shift']))
    restored=candidate.cup_anchor(exported,pose,rotates)
    assert g.outside_volume(restored,fixture)<1e-6 and g.outside_volume(fixture,restored)<1e-6
    wrong=candidate.cup_anchor(exported,pose,not rotates)
    assert g.outside_volume(wrong,fixture)>.1
reject(lambda:candidate.concept_rules('post-glue unknown'),'Unsupported post-glue concept')
for gap in (5.,7.):g.check_rotor(data,[('annular all-angle fixture',fixture)],gap)
# This fin clears at 0 and 180 degrees but hits the real keeper at 90 degrees.
fin=g.r.block(1,1,.5,(31,0,.1));_,fixed=g.fixed_geometry(data,5.)
for angle in (0,180):
    assert all(g.intersection(fin.rotate(Axis.Z,angle),part)<1e-6 for part in fixed.values())
assert sum(g.intersection(fin.rotate(Axis.Z,90),part) for part in fixed.values())>.1
reject(lambda:g.check_rotor(data,[('keeper-striking fin',fin)],5.),'Rotor escapes analytic all-angle envelope')
# No stationary tool or screw may borrow a service port for normal rotation.
below=g.r.block(1,1,1,(38,0,-14))
reject(lambda:g.check_rotor(data,[('below-floor actor',below)],5.),'Rotor escapes analytic all-angle envelope')
producer=data['snapshots']['reference_tools'].parse()
record=producer['control_sweeps'][0]
adaptive=dict(record,mass_integration=g.ADAPTIVE_MASS,
              volume_mm3=g.adaptive_mass(data['artifacts'].load(record)))
g.load_candidate_record(data['artifacts'],adaptive)
reject(lambda:g.load_candidate_record(data['artifacts'],dict(adaptive,volume_mm3=adaptive['volume_mm3']*1.00001)),
       'Actual component disagrees with receipt volume')
reject(lambda:g.load_candidate_record(data['artifacts'],dict(adaptive,mass_integration='unknown')),
       'Unknown candidate mass integration method')
records={rec['name']:rec for rec in producer['control_sweeps']}
work=data['artifacts'].load(records['2.5 mm lock key operating envelope'])
entry=data['artifacts'].load(records['2.5 mm lock key full axial staging'])
sweeps=dict(entry=[('whole entry',entry)],operation=[('whole turn',work)],withdrawal=[('whole reverse entry',entry)])
point=[38*2**-.5*-1,38*2**-.5,10.7]
assert abs(g.service_index(point,'lock')+90)<1e-6
axis=dict(point=point,direction=[0,0,-1],AF_mm=2.5)
op=dict(action_id='reference-lock-tool-only',tool_name='2.5 mm hex key',tool_part='Wera 05021610001',
        gap_mm=5.,mouth_z_mm=5.,service_index_degrees=-90.,access='root',target_axis=axis,tool_axis=axis,approach_source=[0,0,-1])
for gap in (5.,7.):g.check_operation(data,dict(op,gap_mm=gap,mouth_z_mm=gap),sweeps)
# Bar lift and source cup/tool shift cancel; fixed base height must not follow the ball.
for lift in (2.,50.):
    shifted={phase:[(name,part.translate((0,0,lift))) for name,part in rows] for phase,rows in sweeps.items()}
    result=g.check_operation(data,dict(op,mouth_z_mm=5+lift),shifted)
    assert result['fixed_base_gap_mm']==5 and result['bar_mouth_z_range_mm']==[5+lift]*2
box_sweeps={phase:[(name,g.audit.pose(part,5.,-90.)) for name,part in rows] for phase,rows in sweeps.items()}
box_axis=dict(point=[point[0],point[1],5-point[2]],direction=[0,0,1],AF_mm=2.5)
box_op=dict(op,target_axis=box_axis,tool_axis=box_axis,approach_box=[0,0,1],bar_mouth_z_range_mm=[5,7])
box_op.pop('mouth_z_mm');box_op.pop('approach_source')
result=g.check_box_operation(data,box_op,box_sweeps)
assert result['bar_mouth_z_range_mm']==[5,7] and result['geometry_frame']=='box'
reject(lambda:g.check_box_operation(data,dict(box_op,approach_box=[0,0,-1]),box_sweeps),'Root entry must approach axially')
missing=dict(op);del missing['mouth_z_mm']
reject(lambda:g.check_operation(data,missing,sweeps),'Missing tool binding field: mouth_z_mm')
reject(lambda:g.load_records(data,data['report']['review_components'][:-1],
                            {r['name'] for r in data['report']['review_components']}),'Incomplete/duplicate geometry inventory')
# Canonical upright angle 225 is not installed box angle 135: omitting Z-90 hits the base.
reject(lambda:g.check_operation(data,dict(op,service_index_degrees=0),sweeps),'Bound lifecycle tool against compact base blocked')
reject(lambda:g.check_operation(data,dict(op,tool_name='printed special fork'),sweeps),'Nonstandard tool')
profile_only=dict(sweeps,entry=[('profile only',fixture.faces()[0])])
reject(lambda:g.check_operation(data,op,profile_only),'Whole-tool sweep requires a valid single solid')
reject(lambda:g.check_operation(data,dict(op,approach_source=[1,0,0]),sweeps),'Root entry must approach axially')
reject(lambda:g.check_operation(data,op,{'entry':sweeps['entry'],'operation':sweeps['operation']}),'Explicit entry/operation/withdrawal')
reject(lambda:g.check_operation(data,dict(op,tool_axis=dict(axis,point=[point[0]+1,point[1],point[2]])),sweeps),'Tool is not on declared actuator axis')
reject(lambda:g.check_operation(data,dict(op,tool_axis=dict(axis,AF_mm=2)),sweeps),'Tool AF differs')
# Native failures cannot be interpreted as empty space.
class FailedBoolean:
    def SetArguments(self,_):pass
    def SetTools(self,_):pass
    def SetFuzzyValue(self,_):pass
    def FuzzyValue(self):return 1e-7
    def SetRunParallel(self,_):pass
    def Build(self):pass
    def IsDone(self):return False
    def Shape(self):raise AssertionError('Failed Boolean result was read')
with patch.object(g,'BRepAlgoAPI_Common',FailedBoolean):
    reject(lambda:g.intersection(fixture,fixture),'Native Boolean did not complete')
from OCP.TopoDS import TopoDS_Shape
class NullBoolean(FailedBoolean):
    def IsDone(self):return True
    def Shape(self):return TopoDS_Shape()
with patch.object(g,'BRepAlgoAPI_Common',NullBoolean):
    reject(lambda:g.intersection(fixture,fixture),'Native Boolean returned null')
class InvalidAnalyzer:
    def __init__(self,*_):pass
    def IsValid(self):return False
with patch.object(g,'BRepCheck_Analyzer',InvalidAnalyzer):
    reject(lambda:g.intersection(fixture,fixture),'Invalid native input')
calls=[0]
class InvalidOutputAnalyzer:
    def __init__(self,*_):calls[0]+=1;self.call=calls[0]
    def IsValid(self):return self.call<3
with patch.object(g,'BRepCheck_Analyzer',InvalidOutputAnalyzer):
    reject(lambda:g.intersection(fixture,fixture),'Native Boolean returned invalid topology')
# Fresh namespace enforcement includes files, real directories and dangling symlinks.
with tempfile.TemporaryDirectory(prefix='base-gate-freeze-negative-') as directory:
    root=Path(directory)
    existing=root/'old';existing.mkdir();sentinel=existing/'receipt.json';sentinel.write_text('preserve old data')
    reject(lambda:g.freeze_report(data,report,existing),'Proof namespace already exists')
    assert sentinel.read_text()=='preserve old data'
    existing_file=root/'old-file';existing_file.write_text('preserve file')
    reject(lambda:g.freeze_report(data,report,existing_file),'Proof namespace already exists')
    symlink=root/'old-link';symlink.symlink_to(root/'does-not-exist')
    reject(lambda:g.freeze_report(data,report,symlink),'Proof namespace already exists')
    assert symlink.is_symlink() and existing_file.read_text()=='preserve file'
    # A changed captured receipt fails before the fresh output directory is created.
    source=root/'input.json';source.write_bytes(args.base_receipt.read_bytes())
    snapshot=g.ear.ReceiptSnapshot.capture(source)
    wrong=dict(data,snapshots=dict(data['snapshots'],base=snapshot))
    source.write_bytes(source.read_bytes()+b' ')
    reject(lambda:g.freeze_report(wrong,report,root/'must-not-exist'),'Base source receipt changed')
    assert not (root/'must-not-exist').exists()
    # Real proof-byte mutation during final validation must retain only an INVALID artifact.
    corrupt=root/'proof-mutation';original_digest=g.audit.digest
    def mutate_proof(path):
        if path==corrupt/'receipt.json':path.write_bytes(path.read_bytes()+b' ')
        return original_digest(path)
    with patch.object(g.audit,'digest',mutate_proof):
        reject(lambda:g.freeze_report(data,report,corrupt),'Frozen proof changed during write')
    assert not (corrupt/'receipt.json').exists() and (corrupt/'receipt.INVALID.json').is_file()
g.unchanged(data)
print('PASS: exact compact g5/g7 analytic rotary windows and bound whole tools; between-angle keeper collision, below-floor rotor, wrong service frame, custom/side tool, omitted withdrawal and wrong axis/AF, native failure/null/invalid results, stale namespaces and changed input rejected. No coupling lifecycle admitted.')
