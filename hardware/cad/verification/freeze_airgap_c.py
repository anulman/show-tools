"""Freeze new serial-key evidence and independent air-gap protocol; no geometry export."""
import argparse,json,shutil
from pathlib import Path
import airgap_c_admission as admission
import airgap_c_protocol as protocol
import reduced_c_admission as geometry
import post_glue_lifecycle as life
import rotation_connectivity


def pin(path):return dict(path=str(path.resolve()),sha256=geometry.digest(path))


def run(old,service,controls,output):
    if output.exists():raise ValueError('Use a fresh air-gap admission namespace')
    output.mkdir(parents=True);(output/'proofs').mkdir();config=json.loads(old.read_text());loaded=geometry.load(old);proofs={}
    supplied={n:(old.parent/r['path']).resolve() for n,r in config['proofs'].items()}|{'serial-service':service}
    for name,source in supplied.items():
        target=output/'proofs'/(name+'.json');shutil.copyfile(source,target);proofs[name]=dict(path=str(target.relative_to(output)),sha256=geometry.digest(target))
    model,_=protocol.build(loaded['candidate'],proofs);model_path=output/'protocol.json';model_path.write_text(json.dumps(model,indent=2)+'\n')
    modules=(admission,protocol,geometry,life,rotation_connectivity)
    result=dict(schema=1,variant=admission.VARIANT,geometry_admission=pin(old),proofs=proofs,controls=pin(controls),protocol=dict(path='protocol.json',sha256=geometry.digest(model_path)),checker_sources={str(Path(m.__file__).resolve()):geometry.digest(m.__file__) for m in modules},physical_fit_verified=False,requires_combined_base_admission=True)
    target=output/'admission.json';target.write_text(json.dumps(result,indent=2)+'\n');checked=admission.load(target)
    (output/'lifecycle.json').write_text(json.dumps(dict(result=checked['lifecycle'],negative_controls=checked['negative_controls'],inventory=checked['inventory'],rotation_graph=checked['rotation_graph']),indent=2)+'\n');print(target)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('geometry-admission','service','controls','output'):parser.add_argument('--'+name,type=Path,required=True)
    a=parser.parse_args();run(a.geometry_admission,a.service,a.controls,a.output)
