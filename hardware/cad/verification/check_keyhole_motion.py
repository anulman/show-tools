"""Independent continuous bar-clearance certificates for frozen prototypes A and B.

This deliberately does not admit lifecycle, tool access, base fit or strength.
"""
import sys,importlib,math,json,hashlib,os,argparse,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE))
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common,BRepAlgoAPI_Cut
from build123d import Axis
import geometry_artifacts
import final_review
m=importlib.import_module('disco-bar.post_glue_couplings');a=m.channels;c=m.c
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--receipt',type=Path,required=True)
parser.add_argument('--concept',choices=('A','B'),default='A')
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
if os.path.lexists(args.output):raise ValueError('Fresh output namespace required')
raw=args.receipt.read_bytes()
PINS={'A':'30b62bca8f9fff6f300d8f3d30b213efa221b03c8daf4f0b141fa3081dcd2fe9',
      'B':'80d5a3eba9f6dc8d0589ab9034c11cd7d7990a148c02a6babd20734668d3ab94'}
PIN=PINS[args.concept]
lip=-4. if args.concept=='A' else -3.
LOCKS=m.ANGLES if args.concept=='A' else (95.,)
if hashlib.sha256(raw).hexdigest()!=PIN:raise ValueError('Wrong frozen A receipt')
d=json.loads(raw);files=geometry_artifacts.Artifacts()
sources={str(final_review.source_path(n)):sha for n,sha in d['source_code_sha256'].items()}
for independent in (Path(__file__).resolve(),Path(geometry_artifacts.__file__).resolve(),Path(final_review.__file__).resolve()):
    sources[str(independent)]=hashlib.sha256(independent.read_bytes()).hexdigest()
for path,sha in sources.items():
    if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=sha:raise ValueError('Proof source differs: '+path)
results=[];envelopes=[]
bar=files.load(d['environment']);stages={s:{r['name']:files.load(r) for r in x['components']} for s,x in d['stages'].items()}

def amount(op,left,right):
    return a.channel_material_volume(a.channel_boolean(op,left.wrapped,right.wrapped))
def clear(shape,label):
    volume=amount(BRepAlgoAPI_Common,shape,bar)
    print(label,volume,flush=True)
    if volume>1e-5:raise ValueError('Swept envelope hits bar: '+label)
    results.append(dict(check=label,bar_intersection_mm3=volume))
    envelopes.append((label,shape))
def contains(shape,env,label):
    volume=amount(BRepAlgoAPI_Cut,shape,env)
    if volume>1e-5:raise ValueError('Actual material escapes sweep '+label+': '+str(volume))
    results.append(dict(check=label,outside_swept_envelope_mm3=volume))
def cyl(r,low,high,xy=(0,0)):
    return c.cyl(r,high-low,(*xy,(low+high)/2))
core=cyl(33.1,-27.1,100)
outside=cyl(43.5,0,100)
core_region=core+outside
clear(core,'continuous core translation and rotation')
# Root-side material never crosses the bar mouth during axial insertion.
clear(outside,'root-side material never enters bar')
body_region=core_region
if args.concept=='B':
    for angle in m.ANGLES:
        box=m.old.radial(c.box(10,6,2,(37,0,-7.5)),angle)
        body_region+=box
        entry=m.old.radial(c.box(10,6,52,(37,0,17.5)),angle)
        clear(entry,'continuous bayonet lug entry '+str(angle))
        rotation=m.sector(32.,42.15,-8.5,-6.5,angle-5.4,angle+35+5.4)
        clear(rotation,'continuous bayonet lug turn '+str(angle))
        seat=m.old.radial(c.box(10,6,4.1,(37,0,-6.45)),angle+35)
        clear(seat,'continuous bayonet lug seating '+str(angle))
    for stage in ('turned','nuts-seated','locked'):
        region=core_region
        for angle in m.ANGLES:
            region+=m.old.radial(c.box(10,6,4.1,(37,0,-6.45)),angle+35)
        contains(stages[stage]['removable padded knob cup'],region,'actual cup/lug swept coverage '+stage)
for name,part in stages['inserted'].items():
    if name.startswith(('axial M4','threaded M4')):continue
    contains(part,body_region,name)
for angle in LOCKS:
    xy=m.old.xy(38,angle)
    entry=cyl(4.1,-9.1,100,xy)
    clear(entry,'axial entry hardware '+str(angle))
    for name,part in stages['inserted'].items():
        if name.endswith(str(angle)) and name.startswith(('axial M4','threaded M4')):
            contains(part,entry,name)
    for radius,low,high,kind in ((2.1,-9.1,0.,'screw shaft'),(4.1,lip-3.9,lip-.05,'nut, including 0.5 mm captured head float')):
        sweep=m.sector(38-radius,38+radius,low,high,angle,angle+35)
        for theta in (angle,angle+35):sweep+=cyl(radius,low,high,m.old.xy(38,theta))
        clear(sweep,'continuous35 turn '+str(angle)+' '+kind)
    # Full hex prism spans BOTH nut endpoints and all translation in between.
    seat=m.old.radial(c.hexagon(7/math.sqrt(3),5.3,(38,0,lip-1.15)),angle+35)
    clear(seat,'continuous hex seating '+str(angle))
    for stage in ('turned','nuts-seated','locked'):
        part=next(p for n,p in stages[stage].items() if n.startswith('threaded M4') and n.endswith(str(angle)))
        contains(part,seat,'nut sweep endpoint '+stage+' '+str(angle))
    shaft=cyl(2.1,-9.1,0,m.old.xy(38,angle+35))+outside
    clear(shaft,'continuous bolt translation and turning '+str(angle))
    for stage in ('turned','nuts-seated','locked'):
        part=next(p for n,p in stages[stage].items() if n.startswith('axial M4') and n.endswith(str(angle)))
        contains(part,shaft,'bolt endpoint '+stage+' '+str(angle))
# Mutation of the actual frozen environment must be detected by the same native predicate.
fin=c.box(2,2,2,(-33,0,-2))
mutant=bar+fin
if not mutant.is_valid or len(mutant.solids())!=1:raise ValueError('Invalid connected-fin negative control')
if amount(BRepAlgoAPI_Common,core,mutant)<=1e-5:raise ValueError('Connected collision fin was accepted')
files.unchanged()
for path,sha in sources.items():
    if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=sha:raise ValueError('Proof source changed: '+path)
if args.receipt.read_bytes()!=raw:raise ValueError('Frozen candidate receipt changed')
args.output.mkdir(parents=True,exist_ok=False)
records=[]
producer=importlib.import_module('disco-bar.check_couplings')
for label,shape in envelopes:
    records.append(producer.export_piece(c.Piece(label,shape,'conservative continuous swept envelope'),args.output/'sweeps'))
files.unchanged()
for path,sha in sources.items():
    if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=sha:raise ValueError('Proof source changed during export: '+path)
if args.receipt.read_bytes()!=raw:raise ValueError('Frozen candidate changed during export')
report=dict(schema=1,scope='CONTINUOUS RIGID BAR CLEARANCE ONLY',concept=args.concept,candidate_receipt_sha256=PIN,
            method='Actual exported solids contained in conservative primitive swept volumes; completed native OCC intersection with actual frozen bar is empty',
            native_boolean_requested_fuzzy_mm=0.0,native_boolean_intrinsic_tolerance_mm=1e-7,
            accepted_empty_volume_mm3=1e-5,checked_fixed_environment='bare bar already glued inside ball',
            continuous_insertion_turn_seating_tightening_and_reverse_clear=True,
            mechanical_capture_and_lifecycle_admitted=False,base_and_tool_admitted=False,physical_strength_verified=False,
            checked_results=results,swept_envelopes=records,source_sha256=sources,
            input_artifact_sha256=files.files,connected_fin_control_rejected=True,
            limitations=['Kinematic reverse follows the same geometric paths; nut anti-rotation, head capture, operator sequencing and reaction forces require separate lifecycle/mechanical evidence.',
                         'Full tool sweeps and actual base integration are not certified by this report.'])
with (args.output/'receipt.json').open('x') as handle:json.dump(report,handle,indent=2);handle.write('\n')
print(args.output/'receipt.json')
