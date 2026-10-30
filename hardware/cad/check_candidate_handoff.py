"""Exercise real candidate packaging and late-failure publication behavior."""
import argparse
import json
from pathlib import Path
import tempfile
import struct
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
        original_zip = zipfile.ZipFile
        class CorruptPrintZip(original_zip):
            def testzip(self):
                if Path(self.filename).name == 'prototype-print-files.zip':
                    member = self.infolist()[0]
                    with open(self.filename, 'r+b') as stream:
                        stream.seek(member.header_offset)
                        header = stream.read(30)
                        name_length, extra_length = struct.unpack_from('<HH', header, 26)
                        offset = member.header_offset + 30 + name_length + extra_length + member.compress_size//2
                        stream.seek(offset)
                        byte = stream.read(1)
                        stream.seek(offset)
                        stream.write(bytes([byte[0] ^ 1]))
                return super().testzip()
        with patch.object(zipfile,'ZipFile',CorruptPrintZip):

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
