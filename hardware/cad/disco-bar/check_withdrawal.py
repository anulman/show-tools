"""C1 withdrawal witnesses: endpoints alone do not establish a usable release path."""
import argparse,hashlib,importlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import disco_bar
m=importlib.import_module('disco-bar.couplings')
proof=importlib.import_module('disco-bar.check_couplings')


def run(step,output):
    output.mkdir(parents=True,exist_ok=True)
    destination=output/'C1-withdrawal.json';destination.unlink(missing_ok=True)
    path,reference=disco_bar.load_reference(step);disco_bar.verify_full_reference(path,reference)
    expected=m.pads.build(reference,.2)
    rows=[]
    for distance in (0,-2,-4,-6,-8,-10,-20,-35):
        item=m.c1(reference,'released',bar_shift=distance)
        item.state=f'withdrawal {distance} mm'
        result=proof.check_state(reference,item,expected)
        involved={name for pair in result['intersections'] for name in (pair['a'],pair['b'])}
        result['witness_exports']=[proof.export_piece(p,output/'C1'/'withdrawal-witnesses'/str(-distance)) for p in item.parts if p.name in involved]
        result['bar_shift_source_z_mm']=distance
        rows.append(result)
        print(distance,'mm:',len(result['intersections']),'intersections',flush=True)
    report={'concept':'C1','withdrawal_path_pass':all(r['rigid_clearance_pass'] for r in rows),
            'finding':'Carrier key housing strikes preset flange during intermediate lift; endpoint clearance did not establish a release path.',
            'samples':rows,'reference_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'source_code_sha256':{Path(f).name:hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (m.__file__,proof.__file__,__file__)}}
    destination.write_text(json.dumps(report,indent=2)+'\n')
    for artifact in (output/'C1-receipt.json',output/'interface.json'):
        if artifact.exists():
            previous=json.loads(artifact.read_text())
            if previous.get('concept')=='C1':
                previous['withdrawal_path_pass']=report['withdrawal_path_pass']
                previous['operation_pass']=False
                previous['withdrawal_report']=str(destination.resolve())
                previous['withdrawal_check_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
                artifact.write_text(json.dumps(previous,indent=2)+'\n')
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--step',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();r=run(a.step,a.output);print('C1 withdrawal path PASS:',r['withdrawal_path_pass'])


if __name__=='__main__':main()
