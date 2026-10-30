"""Check new exporter rejects occupied output names before touching their data."""
import hashlib
import importlib
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
checker=importlib.import_module('disco-bar.check_debond_collar')


def snapshot(root):
    return {str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob('*') if path.is_file() and not path.is_symlink()}


def run():
    with tempfile.TemporaryDirectory(prefix='debond-output-boundary-') as directory:
        root=Path(directory)
        existing=root/'existing';existing.mkdir();(existing/'receipt.json').write_bytes(b'TRUSTED RECEIPT\n')
        baseline=root/'baseline';baseline.mkdir();(baseline/'receipt.json').write_bytes(b'FROZEN BASELINE\n')
        plain=root/'occupied';plain.write_bytes(b'USER FILE\n')
        alias=root/'alias';alias.symlink_to(existing,target_is_directory=True)
        dangling=root/'dangling';dangling.symlink_to(root/'missing',target_is_directory=True)
        before=snapshot(root)
        for target in (existing,baseline,plain,alias,dangling):
            try:checker.run(None,target,None,None)
            except ValueError as error:
                if 'fresh output directory' not in str(error):raise
            else:raise AssertionError('Existing namespace accepted: '+str(target))
            assert snapshot(root)==before
            assert alias.is_symlink() and dangling.is_symlink()
            assert not (root/'missing').exists()
        print('PASS existing directory, baseline, file, symlink and dangling symlink preserved before input parsing')


if __name__=='__main__':run()
