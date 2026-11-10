#!/usr/bin/python3
"""Freeze this local, inactive review packet. Performs no installation or transport."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
sha = lambda data: hashlib.sha256(data).hexdigest()
grant = json.loads((root / 'grant.inactive.json').read_bytes())
if grant['active'] is not False or grant['version'] != 1:
    raise ValueError('Only the initial inactive review packet can be frozen')
grant['checkerSha256'] = sha((root / 'check.py').read_bytes())
grant['signersSha256'] = sha((root / 'allowed_signers').read_bytes())
(root / 'grant.inactive.json').write_text(json.dumps(grant, indent=2) + '\n')
grant['active'] = True
active = (json.dumps(grant, indent=2) + '\n').encode()
files = {}
for name in ('check.py', 'grant.inactive.json', 'allowed_signers', 'bootstrap.py'):
    data = (root / name).read_bytes()
    files[name] = {'bytes': len(data), 'sha256': sha(data)}
manifest = {'schemaVersion': 1, 'files': files, 'activeGrantSha256': sha(active)}
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'manifestSha256': sha((root / 'manifest.json').read_bytes()),
                  'activeGrantSha256': sha(active), 'installed': False}))
