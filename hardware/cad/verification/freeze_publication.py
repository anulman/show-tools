"""Assemble a frozen, recheckable human-review bundle from completed CAD checks."""
from __future__ import annotations
import argparse,hashlib,json,shutil
from pathlib import Path
from candidate_protocol import write
from publication_bundle import check_bound_paths,proof_requirements,load,required_proofs,digest,rotor_graph

CLAIMS=['post-glue assembly and complete reversal under the instructed protocol',
        'ordinary tools and root-only installed access',
        'continuous motion and every-angle base rotation clearance',
        'full source profile, socket and post-removal debond passages',
        'complete actual printed and purchased component inventory']
PHYSICAL_CHECKS=['Actual knob fit against the accepted original socket; ruler dimensions are approximate.',
    'Resin shrinkage, brittleness, thread/captive-pocket life and print orientation.',
    'Pad compression/recovery, grip torque and pull strength under expected loads.',
    'Adhesive/shell compatibility, balance, bearing drag and operator tool handling.']


def run(config_path,output):
    if output.exists():raise ValueError('Use a fresh publication namespace')
    config=json.loads(config_path.read_text());output.mkdir(parents=True)
    selector=dict(schema=1,presentation='three-post-glue-review-candidates',candidates=[])
    for concept in ('A','B','C'):
        record=config[concept];receipt=Path(record['candidate']['path'])
        if digest(receipt)!=record['candidate']['sha256']:raise ValueError('Unexpected candidate freeze')
        candidate=json.loads(receipt.read_text());check_bound_paths(candidate)
        if set(record['proofs'])!=required_proofs(concept):raise ValueError('Incomplete evidence categories')
        folder=output/concept;folder.mkdir();evidence={};proofs={}
        for name,pin in record['proofs'].items():
            source=Path(pin['path'])
            if digest(source)!=pin['sha256']:raise ValueError('Unexpected proof pin: '+name)
            report=json.loads(source.read_text());check_bound_paths(report);proof_requirements(name,report,concept)
            target=folder/(name+'.json');shutil.copyfile(source,target)
            evidence[name]=dict(path=str(target.relative_to(output)),sha256=digest(target))
            proofs[name]=evidence[name]
        result=write(concept,receipt,evidence,folder,evidence_root=output)
        admission=dict(schema=1,concept=concept,human_review_candidate=True,manufacturing_approved=False,
            physical_fit_verified=False,candidate_receipt=record['candidate'],proofs=proofs,
            protocol=dict(path=str((folder/'protocol.json').relative_to(output)),sha256=digest(folder/'protocol.json')),
            model_sha256=result.model_sha256,rotation_graph=rotor_graph(concept),verified_requirements=CLAIMS,physical_checks_remaining=PHYSICAL_CHECKS)
        target=folder/'admission.json';target.write_text(json.dumps(admission,indent=2)+'\n')
        selector['candidates'].append(dict(concept=concept,path=str(target.relative_to(output)),sha256=digest(target)))
    path=output/'selector.json';path.write_text(json.dumps(selector,indent=2)+'\n')
    load(path)
    print(path)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.config,args.output)
