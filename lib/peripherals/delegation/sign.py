#!/usr/bin/python3
"""Write an ordinary mailbox submission containing a signed plan. No transport."""
import argparse
import base64
import json
import math
import re
from pathlib import Path
import subprocess
import sys

MAX_PAYLOAD = 8192
MAX_CONTENT = 16000
MAX_REQUEST = 32768
NAMESPACE = 'show-tools-peripheral-deploy-v1'


def submission(payload, signature):
    if not 0 < len(payload) <= MAX_PAYLOAD or not 0 < len(signature) <= 2048:
        raise ValueError('payload or signature size limit')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    def number(value):
        result = float(value)
        if not math.isfinite(result):
            raise ValueError('nonfinite JSON')
        return result
    plan = json.loads(payload.decode(), object_pairs_hook=pairs, parse_float=number,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))
    request_id = plan['requestId']
    if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', request_id):
        raise ValueError('invalid request ID')
    content = json.dumps({'kind': 'show-tools-peripheral-signed-action-v1',
                         'payloadBase64': base64.b64encode(payload).decode(),
                         'signature': signature.decode('ascii')}, separators=(',', ':'), ensure_ascii=True)
    request = json.dumps({'op': 'submit', 'id': request_id, 'content': content}, separators=(',', ':'), ensure_ascii=True).encode() + b'\n'
    if len(content.encode()) > MAX_CONTENT or len(request) > MAX_REQUEST:
        raise ValueError('serialized mailbox size limit')
    return request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--key', type=Path, required=True)
    args = parser.parse_args()
    with args.plan.open('rb') as stream:
        payload = stream.read(MAX_PAYLOAD + 1)
    if not 0 < len(payload) <= MAX_PAYLOAD:
        raise ValueError('payload size limit')
    submission(payload, b'validation-only')
    result = subprocess.run(['/usr/bin/ssh-keygen', '-Y', 'sign', '-f', str(args.key), '-n', NAMESPACE],
                            input=payload, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=15, check=True, env={'PATH': '/usr/bin:/bin', 'LANG': 'C'})
    sys.stdout.buffer.write(submission(payload, result.stdout))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
