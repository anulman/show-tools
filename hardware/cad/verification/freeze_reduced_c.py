"""Bind exact proof files to a fresh17-actor protocol; combined base still required."""
from __future__ import annotations
import argparse,hashlib,json,shutil,sys
from pathlib import Path
import reduced_c_admission as admission
import reduced_c_protocol as protocol
import post_glue_lifecycle as life
import candidate_protocol,rotation_connectivity,publication_bundle


def pin(path):return dict(path=str(path),sha256=admission.digest(path))


def run(candidate,proofs_path,controls,output):
    if output.exists():raise ValueError('Use a fresh admission namespace')
    output.mkdir(parents=True);(output/'proofs').mkdir();proofs={}
    supplied=json.loads(proofs_path.read_text())
    if set(supplied)!=admission.REQUIRED:raise ValueError('Wrong proof category inventory')
    for name,path in supplied.items():
        source=Path(path);report=json.loads(source.read_text());publication_bundle.check_bound_paths(report);admission.requirements(name,report)
        target=output/'proofs'/(name+'.json');shutil.copyfile(source,target);proofs[name]=dict(path=str(target.relative_to(output)),sha256=admission.digest(target))
    model,_=protocol.build(json.loads(candidate.read_text()),proofs);model_path=output/'protocol.json';model_path.write_text(json.dumps(model,indent=2)+'\n')
    modules=(admission,protocol,life,candidate_protocol,rotation_connectivity,publication_bundle)
    checker_sources={str(Path(module.__file__).resolve()):admission.digest(module.__file__) for module in modules}
    config=dict(schema=1,variant='reduced-cover-B',candidate=pin(candidate),protocol=dict(path='protocol.json',sha256=admission.digest(model_path)),proofs=proofs,controls=pin(controls),checker_sources=checker_sources,physical_fit_verified=False,requires_combined_base_admission=True)
    path=output/'admission.json';path.write_text(json.dumps(config,indent=2)+'\n')
    result=admission.load(path)
    (output/'lifecycle.json').write_text(json.dumps(dict(result=result['lifecycle'],negative_controls=result['negative_controls'],inventory=result['inventory']),indent=2)+'\n')
    print(path,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for arg in ('candidate','proofs','controls','output'):parser.add_argument('--'+arg,type=Path,required=True)
    args=parser.parse_args();run(args.candidate,args.proofs,args.controls,args.output)
