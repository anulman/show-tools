#!/usr/bin/python3
"""Freeze an inactive review packet; no installation, transport or device access."""
import argparse
import importlib.util
import json
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-map', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    if bool(args.input_map) != bool(args.out):
        parser.error('--input-map FILE and --out NEW_DIRECTORY are required together')
    root = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location('reviewed_peripheral_checker', root / 'check.py')
    check = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(check)
    grant = check.strict_json((root / 'grant.inactive.json').read_bytes(), 32768)
    check.require(grant['active'] is False and type(grant['version']) is int and grant['version'] == 1,
                  'Only the initial inactive review packet can be frozen')
    grant['checkerSha256'] = check.sha((root / 'check.py').read_bytes())
    grant['signersSha256'] = check.sha((root / 'allowed_signers').read_bytes())
    ready = args.input_map is not None
    if ready:
        with args.input_map.open('rb') as stream:
            input_map = check.strict_json(stream.read(32769), 32768)
        grant['target']['peripheralAssignment']['inputMap'] = check.validate_input_map(input_map)
        check.validate_grant(check.canonical(grant), (root / 'check.py').read_bytes(),
                             (root / 'allowed_signers').read_bytes())
    else:
        check.require(grant['target']['peripheralAssignment']['inputMap'] is None,
                      'Source template must not contain an installation map')
    content = {name: (root / name).read_bytes() for name in ('check.py', 'allowed_signers', 'bootstrap.py')}
    content['grant.inactive.json'] = (json.dumps(grant, indent=2) + '\n').encode()
    grant['active'] = True
    active_sha = check.sha((json.dumps(grant, indent=2) + '\n').encode()) if ready else None
    manifest = {'schemaVersion': 1,
                'files': {name: {'bytes': len(data), 'sha256': check.sha(data)}
                          for name, data in content.items()}, 'activeGrantSha256': active_sha}
    content['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    if ready:
        args.out.mkdir(mode=0o700)
        os.chmod(args.out, 0o700)
        for name, data in content.items():
            fd = os.open(args.out / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
    else:
        for name in ('grant.inactive.json', 'manifest.json'):
            (root / name).write_bytes(content[name])
    print(json.dumps({'ready': ready, 'manifestSha256': check.sha(content['manifest.json']),
                      'activeGrantSha256': active_sha, 'installed': False}))


if __name__ == '__main__':
    main()
