"""Exercise publication tamper detection and C's real root collision rejection."""
from __future__ import annotations
import argparse,copy,hashlib,importlib,json,shutil,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from publication_bundle import load,Violation
from build123d import import_step,export_step,export_stl


def run(selector,output):
    if output.exists():raise ValueError('Use fresh control namespace')
    output.mkdir();clone=output/'publication';shutil.copytree(selector.parent,clone)
    data=json.loads(selector.read_text());load(clone/'selector.json');results={}
    for concept in 'ABC':
        path=clone/concept/'external.json';original=path.read_bytes();path.write_bytes(original+b'\n')
        try:load(clone/'selector.json')
        except Violation as error:
            if 'Changed/missing frozen file' not in str(error):raise
            results[concept+' altered proof']=str(error)
        else:raise AssertionError('Altered actual evidence admitted')
        finally:path.write_bytes(original)
    load(clone/'selector.json')
    c_record=next(r for r in data['candidates'] if r['concept']=='C')
    admission=json.loads((selector.parent/c_record['path']).read_text())
    source=json.loads(Path(admission['candidate_receipt']['path']).read_text())
    checker=importlib.import_module('disco-bar.check_post_glue_c_root_motion');c=checker.c
    bar=import_step(source['environment']['step'])
    mutated=bar+c.box(2.,9.,2.,(0,36.5,-2.))
    if not mutated.is_valid or len(mutated.solids())!=1:raise ValueError('Connected fin control invalid')
    folder=output/'C-connected-fin';folder.mkdir();step=folder/'mutated.step';stl=folder/'mutated.stl'
    export_step(mutated,step);export_stl(mutated,stl)
    for kind,path in [('step',step),('stl',stl)]:
        source['environment'][kind]=str(path);source['environment'][kind+'_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    receipt=folder/'receipt.json';receipt.write_text(json.dumps(source,indent=2)+'\n')
    try:checker.run(receipt,folder/'proof-MUST-NOT-PASS')
    except ValueError as error:
        if 'complete fixed cup axial entry and reverse blocked by glued bar' not in str(error):raise
        results['C real connected root fin']=str(error)
    else:raise AssertionError('Actual blocked C root admitted')
    load(selector)
    (output/'receipt.json').write_text(json.dumps(dict(schema=1,controls=results,original_publication_restored_and_rechecked=True),indent=2)+'\n')
    print(json.dumps(results,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--selector',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();run(args.selector,args.output)
