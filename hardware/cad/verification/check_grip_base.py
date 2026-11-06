"""Every-angle base clearance for actual full external grip-key motion bounds."""
from __future__ import annotations
import argparse,hashlib,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE));sys.path.insert(0,str(HERE/'box-mount/access'))
from geometry_artifacts import Artifacts
import post_glue_base_gate as gate
from build123d import import_step


def run(candidate,external,base,output):
    if output.exists():raise ValueError('Use fresh output')
    report=json.loads(external.read_text());sha=hashlib.sha256(candidate.read_bytes()).hexdigest()
    if report['source_receipt_sha256']!=sha:raise ValueError('Different candidate grip proof')
    selected=[r for r in report['evidence'] if any(r['id']==sign+' grip key '+phase for sign in ('-1','+1') for phase in ('entry','operation','withdrawal'))]
    if len(selected)!=6:raise ValueError('Incomplete full grip-key phases')
    files=Artifacts();bounds=[]
    for row in selected:
        for record in row['sweeps']:bounds.append((row['id'],files.load(record).translate((0,0,-50))))
    data=gate.load_base(base);results={}
    for gap in (5.,7.):
        # Full shaft stays >=g+12. Full revolving handle/axial entry stays
        #outsideR119.5. Expanded R119 band belowshaft level is stricter.
        window=gate.cad.cyl(150.,200.-(gap+12.),gap+12.)
        window+=gate.cad.ring(119.,150.,30.,gap-2.)
        _,fixed=gate.fixed_geometry(data,gap)
        for name,shape in fixed.items():
            if gate.intersection(window,shape)>1e-6:raise ValueError('Grip tool all-angle window hits base '+name)
        rows=[]
        for name,shape in bounds:
            actual=gate.audit.pose(shape,gap,-90.)
            residual=gate.outside_volume(actual,window)
            if residual>1e-6:raise ValueError('Full grip tool escapes all-angle window '+name)
            rows.append(dict(phase=name,outside_window_mm3=residual))
        results[str(int(gap))]=rows
    files.unchanged();gate.unchanged(data)
    output.mkdir()
    result=dict(schema=1,candidate_receipt_sha256=sha,source_external_receipt=str(external),
        full_grip_tools_every_angle_base_clear=True,angular_samples_used=0,results=results,
        scope='Actual full AF1.5 grip-key entry, full handle operation and withdrawal against fixed base; glued ball/bar removed',
        input_files={str(candidate):sha,str(external):hashlib.sha256(external.read_bytes()).hexdigest(),str(base):hashlib.sha256(base.read_bytes()).hexdigest()},
        input_artifact_sha256=files.files,base_input_artifacts=data['artifacts'].files,
        source_sha256={str(Path(__file__).resolve()):hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},physical_strength_verified=False)
    (output/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(output/'receipt.json',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for arg in ('candidate','external','base','output'):p.add_argument('--'+arg,type=Path,required=True)
    args=p.parse_args();run(args.candidate,args.external,args.base,args.output)
