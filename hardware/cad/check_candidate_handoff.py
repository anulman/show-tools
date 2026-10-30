"""Exercise real candidate packaging and late-failure publication behavior."""
import argparse
import json
from pathlib import Path
import tempfile
from unittest.mock import patch
import zipfile

import package_candidate_handoff as package


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection',type=Path,required=True)
    parser.add_argument('--step',type=Path,required=True)
    args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='check-candidate-handoff-') as directory:
        root=Path(directory)
        args.output=root/'failed'
        with patch.object(zipfile.ZipFile,'testzip',return_value='injected-bad-member.stl'):
            try: package.run(args)
            except ValueError as error: assert 'ZIP integrity failed' in str(error)
            else: raise AssertionError('Late ZIP failure accepted')
        assert not args.output.exists(), 'Failed build published an output directory'
        assert list(root.iterdir()) == [], 'Private failed staging was not cleaned'
        print('PASS late ZIP failure leaves no final output or staging',flush=True)
        args.output=root/'complete'
        package.run(args)
        manifest=json.loads((args.output/'validation.json').read_text())
        archive=args.output/'prototype-print-files.zip'
        assert package.digest(archive)==manifest['zip_sha256']
        with zipfile.ZipFile(archive) as z:
            assert z.testzip() is None and len(z.namelist())==26
            assert all(n.endswith('.stl') for n in z.namelist())
        assert (args.output/'Shopping-list.md').is_file()
        assert (args.output/'PTFE-cut-and-form-references.zip').is_file()
        before={str(p.relative_to(args.output)):package.digest(p) for p in args.output.rglob('*') if p.is_file()}
        try: package.run(args)
        except ValueError as error: assert 'fresh output directory' in str(error)
        else: raise AssertionError('Existing handoff replaced')
        after={str(p.relative_to(args.output)):package.digest(p) for p in args.output.rglob('*') if p.is_file()}
        assert before==after
        print('PASS complete 26-STL publication, separate references, existing output unchanged',flush=True)


if __name__=='__main__':
    main()
