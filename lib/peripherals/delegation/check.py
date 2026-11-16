#!/usr/bin/python3
"""Authenticate bounded deployment candidates. This program executes no app actions."""
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import tempfile
import time

CHECKER = Path('/usr/local/libexec/show-tools-peripheral-delegation-check.py')
GRANT = Path('/etc/homelab/delegations/show-tools-peripheral.json')
SIGNERS = Path('/etc/homelab/delegations/show-tools-peripheral.allowed_signers')
LEDGER = Path('/home/anulman/.local/state/show-tools-mailbox/authorization-peripheral.jsonl')
MAX_MESSAGE = 16000
MAX_PAYLOAD = 8192
MAX_SIGNATURE = 2048
MAX_LEDGER = 8388608
MAX_RECORDS = 20000
NAMESPACE = 'show-tools-peripheral-deploy-v1'
PRINCIPAL = 'show-tools-pi'
ACTIONS = {'configure', 'peripheral-start', 'peripheral-stop', 'status', 'rollback'}
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z')
SHA = re.compile(r'[0-9a-f]{64}\Z')
REVISION = re.compile(r'[0-9a-f]{40}\Z')
NONCE = re.compile(r'[0-9a-f]{32}\Z')

TARGET = {'id': 'proxmox/anulman/show-tools-peripheral',
 'hostname': 'proxmox',
 'uid': 1000,
 'gid': 1000,
 'repo': 'anulman/show-tools',
 'service': 'show-tools-peripheral.service',
 'profile': '/home/anulman/.config/show-tools/peripheral.json',
 'unitFile': '/home/anulman/.config/systemd/user/show-tools-peripheral.service',
 'stagingRoot': '/home/anulman/.local/share/show-tools/staging',
 'releaseRoot': '/home/anulman/.local/share/show-tools/releases',
 'releaseNamePattern': '^session-[a-f0-9]{7,40}$',
 'runnerRelativePath': 'bin/show-tools-peripheral',
 'helperRelativePath': 'native/peripheral/peripheral-host',
 'gateway': {'origin': 'https://proxmox.tail54fc55.ts.net:8443',
             'connectAddress': '100.93.139.99',
             'tokenFile': '/home/anulman/.config/show-tools/credentials/token',
             'caFile': None},
}
ASSIGNMENT = {'mapVersion': 2, 'usbVendor': 'd209', 'usbProduct': '0410',
 'reportedSerial': '4', 'serialIsAuthenticatedUnique': False,
 'inputAccess': 'evdev-read-only',
 'outputAccess': 'validated-brightness-only-hidraw', 'preserveEnableMasks': True}
PHYSICAL_CONTROLS = {'blue', 'yellow', 'red', 'green', 'pedal', 'mushroom'}

ARTIFACT_ORIGIN = {'scheme': 'http',
 'host': '100.91.87.3',
 'port': 18742,
 'objectPattern': '^/show-tools-session-release-[a-f0-9]{7,40}\\.tar\\.gz$',
 'redirects': False,
 'ambientProxy': False,
 'maxArchiveBytes': 104857600,
 'maxExpandedBytes': 268435456,
 'maxMembers': 2048,
 'memberCountMeaning': 'raw-tar-headers-including-pax-and-directories'}
CONSTRAINTS = {'requireReviewedImmutableArtifacts': True,
 'requireHostVerifiedEvidence': True,
 'requireCompletedWebStage': True,
 'requireExactOldAndNewFilePins': True,
 'requireFreshAudioOffAndIdleForDisruptiveActions': True,
 'preserveOperatorEnablement': True,
 'requireFreshSessionEpochSequenceHeldFences': True,
 'audioLifecycleAllowed': False,
 'nativeEngineSpawnAllowed': False,
 'syntheticMusicalStartStopAllowed': False,
 'firmwareAllowed': False,
 'enableMaskChangesAllowed': False,
 'devicePermissionChangesAllowed': False,
 'udevChangesAllowed': False,
 'unitEnableAllowed': False,
 'lingerAllowed': False,
 'systemPackagesAllowed': False,
 'sudoGrantsAllowed': False,
 'sshChangesAllowed': False,
 'networkChangesAllowed': False,
 'credentialChangesAllowed': False,
 'deleteReleasesOrBackupsAllowed': False,
 'stopOtherServicesAllowed': False,
 'managerRestartPolicy': 'on-abnormal',
 'unknownPerformanceOrOwnership': 'deny-disruptive-action',
 'appDependencies': 'verified-bundled-only-no-install-hooks',
 'configureInitialFiles': 'create-only-if-signed-old-pin-null',
 'stopScope': 'named-peripheral-service-only-with-owned-output-release',
 'runtimeAuthority': 'fresh-physical-inputs-and-explicit-non-triggering-housekeeping-only',
 'attachmentHousekeeping': {'inputProtocol': 'explicit-source-attach-and-exact-owner-revoke-v2',
                           'releaseWhen': 'initial-attachment-or-cleanup-only',
                           'jiggleConfiguration': 'validated-profile-while-prepared-stopped-or-authoritative-identical-running-noop',
                           'requiredFences': 'reviewed-native-epoch-session-sequence-held'},
 'ownerEvidence': 'cooperating-controller-and-known-owner-checks-not-global-exclusion'}


class Rejected(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise Rejected(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def strict_json(raw, limit):
    require(isinstance(raw, bytes) and 0 < len(raw) <= limit, 'JSON size limit')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    def number(value):
        result = float(value)
        require(math.isfinite(result), 'nonfinite JSON')
        return result
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_float=number,
                          parse_constant=lambda _: (_ for _ in ()).throw(Rejected('nonfinite JSON')))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise Rejected('invalid JSON') from exc


def fields(value, expected):
    require(type(value) is dict and set(value) == set(expected.split()), 'unexpected object fields')


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def validate_input_map(value):
    """The Linux subset of PeripheralInputMapSchema; no musical bindings."""
    require(type(value) is dict, 'explicit version-two input map required')
    fields(value, 'sources switches leds confirmWiring' + (' axis' if 'axis' in value else ''))
    require(type(value['confirmWiring']) is bool, 'explicit wiring confirmation required')
    sources, switches, leds = value['sources'], value['switches'], value['leds']
    require(type(sources) is list and 1 <= len(sources) <= 8, 'bounded Linux sources required')
    require(type(switches) is list and len(switches) <= 6, 'bounded physical switches required')
    require(type(leds) is list and len(leds) <= 6, 'bounded LEDs required')
    require(switches or 'axis' in value, 'explicit inputs required')
    require(not leds or value['confirmWiring'] is True, 'confirmed LED wiring required')
    declared, selectors = {}, set()
    for source in sources:
        fields(source, 'kind id interfaceNumber eventTypes keyCodes relativeAxes')
        require(source['kind'] == 'linux' and matches(re.compile(r'[A-Za-z0-9_-]{1,32}\Z'), source['id'])
                and integer(source['interfaceNumber'], 0, 255), 'explicit Linux selector required')
        require(source['id'] not in declared, 'duplicate input source')
        for name in ('eventTypes', 'keyCodes', 'relativeAxes'):
            codes = source[name]
            require(type(codes) is list and len(codes) <= 1024
                    and all(integer(code, 0, 65535) for code in codes)
                    and all(left < right for left, right in zip(codes, codes[1:])),
                    'sorted unique Linux capabilities required')
        signature = canonical({key: source[key] for key in source if key != 'id'})
        require(signature not in selectors, 'duplicate source selector')
        selectors.add(signature)
        declared[source['id']] = source
    controls, raw_inputs, used = set(), set(), set()
    inputs = []
    for switch in switches:
        fields(switch, 'controlId sourceId type code')
        control = switch['controlId']
        require(type(control) is str and control in PHYSICAL_CONTROLS and control not in controls,
                'unique physical switch required')
        controls.add(control)
        inputs.append((switch, False))
    if 'axis' in value:
        fields(value['axis'], 'sourceId type code')
        inputs.append((value['axis'], True))
    for item, axis in inputs:
        require(type(item['sourceId']) is str and item['sourceId'] in declared,
                'input source not declared')
        source = declared[item['sourceId']]
        require(integer(item['type'], 0, 65535) and integer(item['code'], 0, 65535)
                and item['type'] == (2 if axis else 1)
                and item['type'] in source['eventTypes']
                and item['code'] in source['relativeAxes' if axis else 'keyCodes'],
                'input absent from Linux capabilities')
        signature = (item['sourceId'], item['type'], item['code'])
        require(signature not in raw_inputs, 'aliased physical inputs')
        raw_inputs.add(signature)
        used.add(item['sourceId'])
    require(used == set(declared), 'unused input source')
    controls, channels = set(), set()
    for led in leds:
        fields(led, 'controlId sdkChannel')
        require(type(led['controlId']) is str and led['controlId'] in PHYSICAL_CONTROLS
                and led['controlId'] not in controls and integer(led['sdkChannel'], 0, 95)
                and led['sdkChannel'] not in channels, 'unique LED identity and SDK channel required')
        controls.add(led['controlId'])
        channels.add(led['sdkChannel'])
    return value


def validate_assignment(value):
    fields(value, ' '.join(ASSIGNMENT) + ' inputMap')
    require(canonical({key: value[key] for key in ASSIGNMENT}) == canonical(ASSIGNMENT),
            'unsupported peripheral assignment')
    input_map = validate_input_map(value['inputMap'])
    require({item['controlId'] for item in input_map['switches']} == PHYSICAL_CONTROLS
            and 'axis' in input_map
            and {item['controlId'] for item in input_map['leds']} == {'blue', 'yellow', 'red', 'green'},
            'Complete six-switch, spinner and four-arcade-LED assignment required')
    return value


def protected_file(path, limit, owner=0):
    path = Path(path)
    require(path.is_absolute(), 'canonical path required')
    for ancestor in reversed(path.parents):
        info = ancestor.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
                and not info.st_mode & 0o022, 'unprotected directory')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == owner and info.st_gid == 0
                and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o644, 'unprotected file')
        require(info.st_size <= limit, 'protected file size limit')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            result = stream.read(limit + 1)
        require(len(result) <= limit, 'protected file size limit')
        return result
    finally:
        os.close(fd)


def validate_grant(raw, checker_bytes, signer_bytes):
    grant = strict_json(raw, 32768)
    fields(grant, 'schemaVersion grantId version active expiresAt principal target allowedActions artifactOrigin constraints requestLimits audit checkerSha256 signersSha256')
    require(grant['schemaVersion'] == 1 and type(grant['schemaVersion']) is int,
            'unsupported grant schema')
    require(grant['grantId'] == 'show-tools-peripheral-host-user-v1' and integer(grant['version'], 1, 2147483647), 'unsupported grant identity')
    require(type(grant['active']) is bool and grant['expiresAt'] is None, 'unsupported grant lifetime')
    require(grant['checkerSha256'] == sha(checker_bytes) and grant['signersSha256'] == sha(signer_bytes), 'frozen source hash mismatch')
    principal = grant['principal']
    fields(principal, 'id sshKeyFingerprint sshPublicKey sourceIPv4 signatureNamespace')
    require(principal['id'] == PRINCIPAL and principal['signatureNamespace'] == NAMESPACE
            and principal['sourceIPv4'] == '100.91.87.3', 'unsupported principal')
    require(isinstance(principal['sshPublicKey'], str)
            and re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]{68}', principal['sshPublicKey']), 'Ed25519 key required')
    key_blob = base64.b64decode(principal['sshPublicKey'].split()[1], validate=True)
    require(principal['sshKeyFingerprint'] == 'SHA256:' + base64.b64encode(hashlib.sha256(key_blob).digest()).decode().rstrip('='), 'key fingerprint mismatch')
    expected_signers = f'{PRINCIPAL} namespaces="{NAMESPACE}" {principal["sshPublicKey"]}\n'.encode()
    require(signer_bytes == expected_signers, 'signer policy mismatch')
    target = grant['target']
    fields(target, ' '.join(TARGET) + ' peripheralAssignment')
    require(canonical({key: target[key] for key in TARGET}) == canonical(TARGET), 'unsupported peripheral target')
    validate_assignment(target['peripheralAssignment'])
    require(type(grant['allowedActions']) is list and len(grant['allowedActions']) == len(set(grant['allowedActions']))
            and set(grant['allowedActions']) <= ACTIONS, 'unsupported action policy')
    require(canonical(grant['artifactOrigin']) == canonical(ARTIFACT_ORIGIN), 'unsupported artifact policy')
    require(canonical(grant['constraints']) == canonical(CONSTRAINTS), 'unsupported constraints')
    require(grant['requestLimits'] == {'maxAgeSeconds': 900, 'clockSkewSeconds': 60,
            'maxPayloadBytes': MAX_PAYLOAD, 'maxSignatureBytes': MAX_SIGNATURE}, 'unsupported request limits')
    require(grant['audit'] == {'path': str(LEDGER), 'maxBytes': MAX_LEDGER, 'onFailure': 'deny'}, 'unsupported audit policy')
    return grant


def decode_message(raw):
    envelope = strict_json(raw, MAX_MESSAGE)
    fields(envelope, 'kind payloadBase64 signature')
    require(envelope['kind'] == 'show-tools-peripheral-signed-action-v1', 'unsigned message')
    encoded, signature = envelope['payloadBase64'], envelope['signature']
    require(isinstance(encoded, str) and len(encoded) <= 10924, 'payload size limit')
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise Rejected('invalid payload encoding') from exc
    require(base64.b64encode(payload).decode() == encoded and 0 < len(payload) <= MAX_PAYLOAD, 'noncanonical or oversized payload')
    require(isinstance(signature, str) and 0 < len(signature.encode()) <= MAX_SIGNATURE
            and signature.startswith('-----BEGIN SSH SIGNATURE-----\n')
            and signature.endswith('-----END SSH SIGNATURE-----\n'), 'invalid signature framing')
    return payload, signature.encode()


def validate_lifetime(payload, now):
    issued, expires = payload['issuedAt'], payload['expiresAt']
    require(integer(issued, 0, 4102444800) and integer(expires, issued + 1, issued + 900), 'invalid request lifetime')
    require(issued <= now + 60 and now - issued <= 960 and now <= expires, 'stale or future request')


def validate_payload(payload_bytes, grant, grant_sha, request_id, now):
    payload = strict_json(payload_bytes, MAX_PAYLOAD)
    fields(payload, 'schemaVersion requestId nonce issuedAt expiresAt grantId grantVersion grantSha256 targetId action sourceRevision archive oldProfileSha256 oldUnitSha256 profileSha256 unitSha256 runnerSha256 helperSha256 manifestSha256 sourceReviewSha256 planSha256 peripheralAssignmentSha256 completedWebStage evidence')
    require(type(payload['schemaVersion']) is int and payload['schemaVersion'] == 1, 'unsupported payload schema')
    require(matches(ID, request_id) and payload['requestId'] == request_id, 'request ID mismatch')
    require(matches(NONCE, payload['nonce']), 'invalid nonce')
    validate_lifetime(payload, now)
    require(grant['active'] is True, 'grant inactive')
    require(payload['grantId'] == grant['grantId'] and type(payload['grantVersion']) is int
            and payload['grantVersion'] == grant['version'] and payload['grantSha256'] == grant_sha,
            'current grant mismatch')
    require(payload['targetId'] == grant['target']['id'] and payload['action'] in grant['allowedActions'], 'action outside grant')
    require(matches(REVISION, payload['sourceRevision']), 'full source revision required')
    for key in ('profileSha256', 'unitSha256', 'runnerSha256', 'helperSha256', 'manifestSha256',
                'sourceReviewSha256', 'planSha256', 'peripheralAssignmentSha256'):
        require(matches(SHA, payload[key]), 'invalid content digest')
    require(payload['peripheralAssignmentSha256'] == sha(canonical(grant['target']['peripheralAssignment'])), 'peripheral assignment mismatch')
    for key in ('oldProfileSha256', 'oldUnitSha256'):
        require(matches(SHA, payload[key]) or (payload['action'] == 'configure' and payload[key] is None),
                'old file digest or configure-only absence required')
    if payload['action'] not in ('configure', 'rollback'):
        require(payload['oldProfileSha256'] == payload['profileSha256'] and
                payload['oldUnitSha256'] == payload['unitSha256'], 'lifecycle action cannot replace configuration')
    receipt = payload['completedWebStage']
    fields(receipt, 'requestId evidenceSha256')
    require(matches(ID, receipt['requestId']) and matches(SHA, receipt['evidenceSha256']),
            'completed web stage receipt pin required')
    archive = payload['archive']
    fields(archive, 'url bytes sha256 root installRelease')
    short = payload['sourceRevision'][:7]
    require(archive['url'] == f'http://100.91.87.3:18742/show-tools-session-release-{short}.tar.gz'
            and archive['root'] == f'show-tools-session-release-{short}'
            and archive['installRelease'] == grant['target']['releaseRoot'] + f'/session-{short}', 'archive path outside grant')
    require(integer(archive['bytes'], 1, grant['artifactOrigin']['maxArchiveBytes'])
            and matches(SHA, archive['sha256']), 'invalid archive pins')
    evidence = payload['evidence']
    require(type(evidence) is list and 1 <= len(evidence) <= 8, 'bounded evidence required')
    for item in evidence:
        fields(item, 'kind sha256')
        require(item['kind'] in ('source-review', 'tests', 'artifact-manifest', 'staging-helper', 'host-preflight')
                and matches(SHA, item['sha256']), 'invalid evidence pin')
    return payload


def verify_signature(payload, signature, signers):
    with tempfile.TemporaryDirectory(prefix='show-tools-signature-') as directory:
        path = Path(directory) / 'request.sig'
        path.write_bytes(signature)
        path.chmod(0o600)
        try:
            result = subprocess.run(['/usr/bin/ssh-keygen', '-Y', 'verify', '-f', str(signers),
                '-I', PRINCIPAL, '-n', NAMESPACE, '-s', str(path)], input=payload,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False,
                env={'PATH': '/usr/bin:/bin', 'LANG': 'C'})
        except subprocess.TimeoutExpired as exc:
            raise Rejected('signature verification timed out') from exc
    require(result.returncode == 0, 'signature rejected')


def candidate(raw, request_id, grant_raw, checker_bytes, signer_bytes, signer_path, now):
    grant = validate_grant(grant_raw, checker_bytes, signer_bytes)
    payload_bytes, signature = decode_message(raw)
    verify_signature(payload_bytes, signature, signer_path)
    payload = validate_payload(payload_bytes, grant, sha(grant_raw), request_id, now)
    return {'kind': 'authenticated-candidate', 'executable': False,
            'hostPreconditions': 'unverified', 'sshSourceProvenance': 'not-attested',
            'checkerSha256': sha(checker_bytes), 'payloadSha256': sha(payload_bytes),
            'pins': payload}


def validate_record(row):
    fields(row, 'at operation requestId payloadSha256 nonce grantSha256 grantVersion action outcome evidenceSha256')
    require(integer(row['at'], 0, 4102444800) and matches(ID, row['requestId']), 'invalid audit record')
    require(row['operation'] in ('inspect', 'claim', 'record', 'deny'), 'invalid audit operation')
    if row['operation'] == 'deny':
        require(row['outcome'] == 'denied' and all(row[k] is None for k in ('payloadSha256', 'nonce', 'grantSha256', 'grantVersion', 'action', 'evidenceSha256')), 'invalid denial record')
    else:
        require(matches(SHA, row['payloadSha256']) and matches(NONCE, row['nonce'])
                and matches(SHA, row['grantSha256']) and integer(row['grantVersion'], 1, 2147483647)
                and row['action'] in ACTIONS, 'invalid audit pins')
        require((row['operation'], row['outcome']) in {('inspect', 'inspected'), ('claim', 'claimed'),
                ('record', 'running'), ('record', 'completed'), ('record', 'blocked'), ('record', 'uncertain')}, 'invalid audit transition')
        require(matches(SHA, row['evidenceSha256']) if row['operation'] == 'record'
                else row['evidenceSha256'] is None, 'invalid outcome evidence digest')


def genesis(fd, now):
    info = os.fstat(fd)
    return {'kind': 'show-tools-authorization-genesis', 'schemaVersion': 1,
            'principal': PRINCIPAL, 'namespace': NAMESPACE, 'createdAt': now,
            'nonce': os.urandom(16).hex(), 'device': info.st_dev, 'inode': info.st_ino}


def validate_genesis(row, fd):
    fields(row, 'kind schemaVersion principal namespace createdAt nonce device inode')
    info = os.fstat(fd)
    require(row['kind'] == 'show-tools-authorization-genesis' and type(row['schemaVersion']) is int
            and row['schemaVersion'] == 1 and row['principal'] == PRINCIPAL
            and row['namespace'] == NAMESPACE and matches(NONCE, row['nonce'])
            and integer(row['createdAt'], 0, 4102444800)
            and type(row['device']) is int and row['device'] == info.st_dev
            and type(row['inode']) is int and row['inode'] == info.st_ino, 'invalid audit genesis or replaced inode')


def ledger_event(stream, request_id, operation, report, now, outcome=None, evidence_sha=None, limit=MAX_LEDGER, refresh=None, validate_storage=None):
    fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
    if validate_storage is not None:
        validate_storage()
    stream.seek(0)
    raw = stream.read(limit + 1)
    require(0 < len(raw) <= limit and raw.endswith(b'\n'), 'audit missing, empty, corrupt or full')
    lines = raw.splitlines()
    require(len(lines) <= MAX_RECORDS, 'audit record cap')
    validate_genesis(strict_json(lines[0], 4096), stream.fileno())
    claims, nonces, results = {}, set(), {}
    for line in lines[1:]:
        row = strict_json(line, 4096)
        validate_record(row)
        rid = row['requestId']
        if row['operation'] == 'claim':
            require(rid not in claims and row['nonce'] not in nonces, 'audit duplicate claim')
            claims[rid] = row
            nonces.add(row['nonce'])
        elif row['operation'] == 'record':
            require(rid in claims and results.get(rid) not in ('completed', 'blocked', 'uncertain')
                    and not (results.get(rid) == 'running' and row['outcome'] == 'running'), 'audit invalid outcome transition')
            require(row['outcome'] != 'completed' or results.get(rid) == 'running',
                    'completed outcome requires durable running record')
            require(all(row[key] == claims[rid][key] for key in ('payloadSha256', 'nonce', 'grantSha256', 'grantVersion', 'action')), 'audit result mismatch')
            results[rid] = row['outcome']
    if refresh is not None:
        report, now = refresh()
    if operation == 'deny':
        row = dict(at=now, operation='deny', requestId=request_id, payloadSha256=None,
                   nonce=None, grantSha256=None, grantVersion=None, action=None, outcome='denied', evidenceSha256=None)
    elif operation == 'record':
        require(request_id in claims and results.get(request_id) not in ('completed', 'blocked', 'uncertain')
                and not (results.get(request_id) == 'running' and outcome == 'running'), 'unknown or already recorded claim')
        require(outcome in ('running', 'completed', 'blocked', 'uncertain') and matches(SHA, evidence_sha), 'invalid outcome or evidence digest')
        require(outcome != 'completed' or results.get(request_id) == 'running',
                'completed outcome requires durable running record')
        row = dict(claims[request_id], at=now, operation='record', outcome=outcome, evidenceSha256=evidence_sha)
    else:
        require(operation in ('inspect', 'claim'), 'invalid ledger operation')
        pins = report['pins']
        if operation == 'claim':
            require(request_id not in claims and pins['nonce'] not in nonces, 'already claimed; reconcile instead of replay')
        row = dict(at=now, operation=operation, requestId=request_id,
                   payloadSha256=report['payloadSha256'], nonce=pins['nonce'], grantSha256=pins['grantSha256'],
                   grantVersion=pins['grantVersion'], action=pins['action'],
                   outcome='claimed' if operation == 'claim' else 'inspected', evidenceSha256=None)
    validate_record(row)
    encoded = canonical(row) + b'\n'
    require(len(raw) + len(encoded) <= limit and len(lines) < MAX_RECORDS, 'audit full; operator reconciliation required')
    stream.seek(0, os.SEEK_END)
    require(stream.write(encoded) == len(encoded), 'audit short write')
    stream.flush()
    os.fsync(stream.fileno())
    return row


def validate_ledger_fd(fd):
    info = os.fstat(fd)
    linked = LEDGER.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 1000 and info.st_gid == 1000
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
            'unsafe audit file')
    require(stat.S_ISREG(linked.st_mode) and (linked.st_dev, linked.st_ino) == (info.st_dev, info.st_ino),
            'audit path replaced during admission')


def open_ledger():
    for parent in reversed(LEDGER.parents):
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, 1000)
                and not info.st_mode & 0o022, 'unsafe audit ancestry')
    info = LEDGER.parent.lstat()
    require(info.st_uid == 1000 and stat.S_IMODE(info.st_mode) == 0o700, 'audit parent must be private')
    fd = os.open(LEDGER, os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        validate_ledger_fd(fd)
        return os.fdopen(fd, 'r+b', buffering=0)
    except BaseException:
        os.close(fd)
        raise


def main(argv):
    require(sys.flags.isolated == 1, 'python3 -I required')
    require(os.getuid() == 1000 and os.geteuid() == 1000 and os.getgid() == 1000
            and os.getegid() == 1000 and socket.gethostname().split('.')[0] == 'proxmox', 'assigned host user required')
    require(Path(__file__) == CHECKER, 'installed frozen checker required')
    require((len(argv) == 2 and argv[0] in ('inspect', 'claim'))
            or (len(argv) == 4 and argv[0] == 'record'),
            'usage: inspect|claim ID, or record ID running|completed|blocked|uncertain EVIDENCE_SHA256')
    operation, request_id = argv[:2]
    require(matches(ID, request_id), 'invalid request ID')
    if operation == 'record':
        protected_file(CHECKER, 65536)
        with open_ledger() as stream:
            event = ledger_event(stream, request_id, operation, None, int(time.time()), argv[2], argv[3],
                                 validate_storage=lambda: validate_ledger_fd(stream.fileno()))
        print(json.dumps({'kind': 'recorded-local-outcome', 'executable': False, 'receipt': event}))
        return
    raw = sys.stdin.buffer.read(MAX_MESSAGE + 1)
    report = None
    def refresh():
        nonlocal report
        checker_bytes = protected_file(CHECKER, 65536)
        grant_raw = protected_file(GRANT, 32768)
        signer_bytes = protected_file(SIGNERS, 4096)
        report = candidate(raw, request_id, grant_raw, checker_bytes, signer_bytes, SIGNERS, int(time.time()))
        require(protected_file(GRANT, 32768) == grant_raw
                and protected_file(SIGNERS, 4096) == signer_bytes
                and protected_file(CHECKER, 65536) == checker_bytes, 'policy changed during verification')
        now = int(time.time())
        validate_lifetime(report['pins'], now)
        return report, now
    with open_ledger() as stream:
        try:
            event = ledger_event(stream, request_id, operation, None, None, refresh=refresh,
                                 validate_storage=lambda: validate_ledger_fd(stream.fileno()))
        except Exception:
            ledger_event(stream, request_id, 'deny', None, int(time.time()),
                         validate_storage=lambda: validate_ledger_fd(stream.fileno()))
            raise
    report['receipt'] = event
    print(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as exc:
        print(json.dumps({'kind': 'rejected', 'executable': False, 'error': str(exc)}))
        sys.exit(1)
