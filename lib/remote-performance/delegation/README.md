# Prepare retained deployment consent

This bundle is source for a proposed host-user delegation on `proxmox`. It is not installed or active. The operator must approve the exact reviewed bundle and activate the protected grant once. A verified operator-controlled activation record can establish that approval. A peer message claiming approval cannot.

The application target is `proxmox/anulman/show-tools-web`, UID and GID 1000. It is the confirmed bare-metal host-user app, not an assigned VM or LXC. The inactive grant lists the exact paths, Scarlett assignment and permitted app actions. Native enable, musical Start, infrastructure changes, active-performance interruption, new credentials, unit enable and linger remain excluded.

The mailbox, Pi extension, SQLite schema, forced SSH command and authorized key remain unchanged. The snapshot under `tests/fixtures/` is test data and must never be installed.

## Verify the local source

Run the checks from the repository root. They use temporary signing keys and filesystem fixtures. They do not contact the host or read the production private key.

```sh
python3 -I lib/remote-performance/delegation/freeze.py
python3 -I -m unittest discover -s lib/remote-performance/delegation/tests -p 'test_*.py'
node --import tsx --test lib/remote-performance/tests/delegation.test.ts
npm run typecheck
```

`freeze.py` updates the inactive template's checker and signer hashes and its three-file installation manifest. A source edit requires fresh pins and review. Routine app releases cannot update the installed checker, signer or grant.

## Run the operator bootstrap in one command

`operator-bootstrap.py` is a separate operator-only wrapper. It does not run through the restricted SSH gateway. The final reviewed command first places its exact hash-pinned bytes in `/root/show-tools-bootstrap-89b1999/operator-bootstrap.py`, owned by root with mode 0600, and then invokes Python with `-B -I`. Its complete source and command must be independently reviewed before execution.

The wrapper reconstructs only six fixed, already-reviewed source files from exact mailbox message IDs. Whole-message hashes, fixed byte ranges and complete file hashes govern reconstruction. The user-owned SQLite database is opened read-only with bounded queries, a VM-step budget and an ordinary-table schema check. No unrelated rows are enumerated or printed.

The operator command installs the inactive protected files, runs the verified initializer as UID and GID 1000, then checks actual protected file hashes and ownership, the unchanged SSH/bridge boundary, account identity and a valid genesis-only ledger. Only those checks allow activation of the exact reviewed policy. Existing authorization history, partial state or drift stops the command without repair, reset or automatic revocation. Pi must still independently inspect the final real state and record active-grant recognition before any signed deployment.

The operator also explicitly requests one-time persistence. The wrapper validates the current enabled-unit/default-target graph, creates only the named pending web enablement link as UID 1000, preserves the existing 0775 user-unit directories and enables linger for `anulman`. Linger persists this user's whole manager, including the reviewed existing agent sockets. It does not isolate persistence to this app. The web unit does not yet exist, so the link is reported as pending installation, not as a running service. No app deployment, service start or restart, native enable or musical Start is requested by the wrapper. Future agents still cannot change linger or unit enablement under the unchanged grant.

A failure after activation reports actual grant state separately from persistence status. Do not repeat an uncertain operation blindly. Inspect and reconcile the reported state. An identical unused bootstrap may be retried; a previously used ledger is preserved and rejected by this one-time wrapper.

## Bootstrap the protected files once

These steps require the operator's explicit approval of the frozen bundle. Agents must not execute them under development or routine deployment consent.

1. Review the complete sources, tests, manifest, target and [charter addition](charter-addition.md). Record the SHA256 of `install.py`, `initialize-ledger.py` and `manifest.json` independently of the candidate directory.
2. In your trusted root terminal, place the reviewed `install.py` in a private root-owned directory. Verify its recorded SHA256 there before executing it. The installer requires root-owned nonwritable ancestry and `python3 -I`.
3. Run the frozen installer with the reviewed bundle directory and manifest hash.

```sh
/usr/bin/python3 -I /root/show-tools-delegation-bootstrap/install.py install REVIEWED_BUNDLE_DIRECTORY REVIEWED_MANIFEST_SHA256
```

The installer copies only these files as root-owned mode 0644.

- `/usr/local/libexec/show-tools-delegation-check.py`.
- `/etc/homelab/delegations/show-tools.json`, initially inactive.
- `/etc/homelab/delegations/show-tools.allowed_signers`.

It creates only missing `/etc/homelab` and `/etc/homelab/delegations` directories. Existing parent directories must be root-owned and nonwritable by group or others. Unexpected files, symlinks or hash drift stop installation. An identical retry succeeds. No candidate code is imported or executed as root. No app, bridge, SSH, service, sudoers, network, account or audio operation occurs.

4. In the ordinary `anulman` terminal, verify the recorded initializer hash. Run the reviewed initializer once.

```sh
/usr/bin/python3 -I REVIEWED_BUNDLE_DIRECTORY/initialize-ledger.py --operator-approved-bootstrap REVIEWED_INACTIVE_GRANT_SHA256
```

This creates `/home/anulman/.local/state/show-tools-mailbox/authorization.jsonl` exclusively under the existing mode 0700 mailbox directory. The genesis records its device and inode. The initializer requires the exact installed inactive version 1 grant. Existing files are never reset. If this step crashes, reconcile the file before continuing. The checker never recreates missing or empty history.

5. Have the trusted host steward verify installed root ownership, exact hashes, the ledger genesis and the unchanged mailbox. Approve the precise charter addition. No Pi extension reload or schema migration is needed.
6. Independently review the active grant bytes produced by changing only `active` to `true` and serializing with Python `json.dumps(grant, indent=2) + '\n'`. Record their SHA256. Activate with both the exact current inactive hash and expected active hash.

```sh
/usr/bin/python3 -I /root/show-tools-delegation-bootstrap/install.py activate REVIEWED_INACTIVE_GRANT_SHA256 REVIEWED_ACTIVE_GRANT_SHA256
```

Activation locks the protected parent directory, verifies both hashes and atomically replaces the root-owned grant. Identical retries succeed. It changes no app state. The host steward must verify the final protected active-grant digest and retain the operator's bootstrap record. Installing an inactive template alone grants no consent.

The current host has `Linger=no`. This bundle neither enables the unit nor enables linger. A user web service is not guaranteed to survive the last logout or boot. Always-ready operation requires a separately approved one-time account and service persistence setup.

## Submit a signed candidate

Prepare a strict JSON plan using the fields checked by `validate_payload()` in `check.py`. Timestamps are integer Unix seconds in UTC. A plan expires within 900 seconds and pins the current active grant, full source revision, archive, profile, unit, operator CLI, structured deployment plan, audio assignment and review evidence hashes. The full structured deployment plan is separately supplied and inspected against `planSha256`; its hash is not an instruction to execute shell text.

The audio assignment digest is SHA256 of the grant's `target.audioAssignment` serialized with sorted keys, compact separators and `ensure_ascii=True`. The grant digest is SHA256 of its exact installed bytes. The source revision's first seven characters determine the archive object, archive root and installation release name.

Sign the exact plan bytes with the existing dedicated key. This client writes a normal `submit` JSON request and performs no transport.

```sh
python3 -I lib/remote-performance/delegation/sign.py --plan REVIEWED_PLAN.json --key ~/.ssh/show-tools-pi > REQUEST.json
```

Send `REQUEST.json` through the established pinned-host-key messaging-only SSH command. Preserve the same bytes and request ID on submission retries. The private key stays on the Mac. Unsigned discussion remains ordinary peer data.

The client and checker cap the payload at 8192 bytes, signature at 2048 bytes and complete content at 16000 bytes. The client also checks the actual serialized gateway request against its 32768-byte limit. Base64 carries the exact signed bytes. Unknown fields, duplicate keys, nonfinite numbers and ambiguous wrappers reject.

## Inspect, claim and report on the host

The trusted Pi steward obtains the exact delivered message content and outer mailbox request ID. It must compare the signed ID with that outer ID. Quoted content or a signature under another row cannot become an action.

```sh
/usr/bin/python3 -I /usr/local/libexec/show-tools-delegation-check.py inspect REQUEST_ID < EXACT_MESSAGE_CONTENT.json
```

Every successful result is an `authenticated-candidate` with `executable=false`, `hostPreconditions=unverified` and `sshSourceProvenance=not-attested`. The existing SSH restriction controls network admission. SSHSIG authenticates the signing key, including for a locally reinserted envelope. The checker cannot prove per-message SSH provenance.

Pi independently checks the actual source, artifact, ABI, manifest, profile, unit, CLI, staging helper, ownership, idle state and fixed audio assignment. Signed evidence hashes and client claims do not prove those facts. The stager independently enforces 2048 raw tar headers, including PAX and directories, 100 MiB archive and 256 MiB expanded data. This verifier checks the policy and pins; it neither downloads nor parses an archive.

After preflight, reserve the action exactly once.

```sh
/usr/bin/python3 -I /usr/local/libexec/show-tools-delegation-check.py claim REQUEST_ID < EXACT_MESSAGE_CONTENT.json
```

The checker locks the existing ledger before rereading the current protected grant, authenticating the message and checking the fresh clock. It appends and fsyncs the claim before returning. Another claim for the same ID or nonce always rejects, including after a crash or completed action. A claimed action may already have had an effect. Reconcile uncertain outcomes instead of replaying them.

Immediately before any host mutation, run `inspect` again and obtain a current eligible result. Do not issue another claim. This observes revocation or expiry after the earlier claim. Pi then performs only the independently checked, in-scope app action under the operator's conditional standing consent. The verifier supplies no executor, privilege or host-preflight bypass.

Record a bounded nonsecret host-evidence digest and the local outcome. `running` may precede one terminal outcome. A terminal outcome cannot be replaced. Recording an existing claim's result remains possible after expiry or revocation and does not authorize an action.

```sh
/usr/bin/python3 -I /usr/local/libexec/show-tools-delegation-check.py record REQUEST_ID running HOST_EVIDENCE_SHA256
/usr/bin/python3 -I /usr/local/libexec/show-tools-delegation-check.py record REQUEST_ID completed HOST_EVIDENCE_SHA256
```

Use `blocked` or `uncertain` when appropriate. Reply explicitly through the existing mailbox reply tool. Receipt of a message, a claim or a file write is not proof of deployment completion.

The ledger is capped at 8 MiB and 20000 records. Truncation, malformed rows, replacement inode, unsafe ownership, extra links, missing history, audit failure or a full ledger deny further admission. No automatic repair or rotation occurs. Audit records contain identifiers, hashes, actions, times and outcomes, not signed payloads, credentials or arbitrary logs.

The ledger and Pi share UID 1000 with the application. Their history is not tamper-proof against arbitrary same-UID compromise. Root ownership protects the authority definition. This is a conditional trusted-steward process, not an operating-system sandbox.

## Revoke retained consent

Review the replacement grant bytes with `active=false` and `version` incremented by one. Use the same serialization as activation. Record the replacement hash and run the frozen installer in the operator's root terminal.

```sh
/usr/bin/python3 -I /root/show-tools-delegation-bootstrap/install.py revoke CURRENT_REVIEWED_GRANT_SHA256 REVIEWED_REVOKED_GRANT_SHA256
```

The replacement is atomic and hash checked. Future inspect and claim calls reject. Revocation never stops an active web service or performance.
