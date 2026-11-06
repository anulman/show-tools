#!/usr/bin/python3
"""Refresh review pins after a source edit. Never installs or activates a grant."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    path = ROOT / 'grant.inactive.json'
    grant = json.loads(path.read_bytes())
    if grant['active'] is not False or grant['version'] != 1:
        raise ValueError('initial inactive template required')
    signer = f'{grant["principal"]["id"]} namespaces="{grant["principal"]["signatureNamespace"]}" {grant["principal"]["sshPublicKey"]}\n'.encode()
    (ROOT / 'allowed_signers').write_bytes(signer)
    grant['checkerSha256'] = digest((ROOT / 'check.py').read_bytes())
    grant['signersSha256'] = digest(signer)
    path.write_text(json.dumps(grant, indent=2) + '\n')
    manifest = {}
    for name in ('check.py', 'grant.inactive.json', 'allowed_signers'):
        data = (ROOT / name).read_bytes()
        manifest[name] = {'bytes': len(data), 'sha256': digest(data)}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for name in ('manifest.json', 'install.py', 'initialize-ledger.py'):
        print(digest((ROOT / name).read_bytes()) + '  ' + name)


if __name__ == '__main__':
    main()
