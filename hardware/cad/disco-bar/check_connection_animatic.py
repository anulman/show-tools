"""Check the actual rendered animatic's source, rigid poses, tool order and output."""
from __future__ import annotations
import argparse,hashlib,importlib,json,math,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
a=importlib.import_module('disco-bar.animate_post_glue')


def check_order(concept,clips):
    for previous,current in zip(clips,clips[1:]):
        if previous['end']!=current['start']:raise ValueError('Animation jumps between operations')
    for clip in clips:
        s,e=clip['start'],clip['end']
        for p in (s,e):
            if not (0<=p['turn']<=35 and 0<=p['lift']<=50 and 0<=p['drop']<=2.1):raise ValueError('Outside proved motion range')
            if not math.isclose(p['drop'],p['screw']*.7,abs_tol=1e-8):raise ValueError('Wrong M4 pitch/stroke')
        if s['index']!=e['index']:
            if not all(p['key3']==100 and p['key4']==100 for p in (s,e)):raise ValueError('Whole rotor indexed with a key inserted')
        if s['turn']!=e['turn']:
            if not all(p['key4']==0 and p['key3']==100 and p['lift']==0 and p['drop']==0 for p in (s,e)):
                raise ValueError('Bayonet turn without its proper tool/seat state')
            if concept=='C' and s['index']!=e['index']:raise ValueError('C cup/knob moves during independent collar action')
        if s['screw']!=e['screw']:
            if not all(p['key3']==0 and p['key4']==100 and p['turn']==35 and math.isclose(p['lift']+p['drop'],2.1) for p in (s,e)):
                raise ValueError('M4 clamp/unclamp has wrong tool or ball stroke')
    return True


def run(folder):
    file=folder/'animation.json';raw=file.read_bytes();report=json.loads(raw);concept=report['concept']
    if hashlib.sha256(Path(a.__file__).read_bytes()).hexdigest()!=report['source_sha256']:raise ValueError('Renderer source changed')
    for path,sha in report['inputs'].items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=sha:raise ValueError('Input changed '+path)
    for name,sha in report['artifacts'].items():
        if hashlib.sha256((folder/name).read_bytes()).hexdigest()!=sha:raise ValueError('Rendered artifact changed')
    if len(report['actual_endpoint_checks'])!=(72 if concept=='B' else 88):raise ValueError('Missing actual endpoint comparisons')
    if any(q['max_vertex_distance_mm']>1e-3 for q in report['actual_endpoint_checks']):raise ValueError('Actual pose mismatch')
    check_order(concept,report['clips'])
    video=folder/(concept.lower()+'-connect-and-release.mp4')
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=width,height,codec_name,nb_frames','-of','json',str(video)]))
    ending_hold=report['clips'][-1]['duration_seconds']
    if abs(float(probe['format']['duration'])-(report['seconds']+ending_hold))>.3:raise ValueError('Wrong actual video duration')
    if not any(s.get('codec_name')=='h264' and s.get('width')==1440 and s.get('height')==900 for s in probe['streams']):raise ValueError('Missing full resolution video stream')
    move=json.loads(json.dumps(next(q for q in report['clips'] if q['start']['index']!=q['end']['index'])))
    move['start']['key3']=0;move['end']['key3']=0
    try:check_order(concept,[move])
    except ValueError as error:
        if 'indexed with a key inserted' not in str(error):raise
    else:raise AssertionError('Key-in-place indexing control admitted')
    result=dict(schema=1,concept=concept,actual_animation_manifest_sha256=hashlib.sha256(raw).hexdigest(),
        source_inputs_and_outputs_match=True,actual_endpoint_poses_match=True,instructed_motion_order_pass=True,
        wrong_tool_indexing_control_rejected=True,ffprobe=probe,
        planned_clip_seconds=report['seconds'],encoder_ending_hold_seconds=ending_hold,
        raster_utilities_sha256=hashlib.sha256(Path(a.r.__file__).read_bytes()).hexdigest(),physical_simulation=False)
    (folder/'verification.json').write_text(json.dumps(result,indent=2)+'\n');print(concept,'actual rendered animatic PASS',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);run(p.parse_args().folder)
