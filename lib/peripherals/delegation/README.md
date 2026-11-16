# Fixed peripheral-service admission

This is a separate, initially inactive policy for `proxmox/anulman/show-tools-peripheral`. It authenticates candidates and maintains one-shot audit claims. It never executes an application action, grants Unix capabilities, or proves host preconditions. The web checker, grant, signer file, and authorization ledger remain unchanged.

The fixed installed files are:

| File | Owner/mode | Purpose |
| --- | --- | --- |
| `/usr/local/libexec/show-tools-peripheral-delegation-check.py` | root:root 0644 | Admission-only checker, invoked with `/usr/bin/python3 -I` as UID/GID 1000 |
| `/etc/homelab/delegations/show-tools-peripheral.json` | root:root 0644 | Exact frozen peripheral policy |
| `/etc/homelab/delegations/show-tools-peripheral.allowed_signers` | root:root 0644 | Existing public key/principal, distinct `show-tools-peripheral-deploy-v1` namespace |
| `/home/anulman/.local/state/show-tools-mailbox/authorization-peripheral.jsonl` | 1000:1000 0600 | Independent inode-bound genesis and append-only claim/outcome history |

The application files are exactly `/home/anulman/.config/show-tools/peripheral.json` and `/home/anulman/.config/systemd/user/show-tools-peripheral.service`, both UID/GID 1000 mode 0600. The runner and helper are `bin/show-tools-peripheral` and `native/peripheral/peripheral-host` inside an already-staged immutable `session-<source-prefix>` release. There is no arbitrary target, grant path, executable path, command, module import, or new global CLI wrapper in the admission interface.

## Deliberate new policy

Only `configure`, `peripheral-start`, `peripheral-stop`, `status`, and `rollback` are allowed. The existing web stage action supplies shared immutable releases; the peripheral checker cannot stage or fetch an archive. A completed web-stage receipt must be pinned and independently reconciled by the host steward.

The assignment names USB d209:0410 with reported serial 4 and pins one complete observed Linux input map: six physical switch IDs, the spinner's relative axis, and four arcade LED associations. Serial 4 is not authenticated globally unique identity. Each source specifies its interface and complete sorted event/key/relative capability sets; raw event type/code pairs and SDK channels are explicit. The native helper still qualifies the actual device. There are no factory-key defaults, musical roles, wildcard selectors or implicit LED channels.

The repository's inactive grant has `inputMap:null` and cannot activate. `freeze.py --input-map FILE --out NEW_DIRECTORY` validates the complete map and produces a separate private review packet. Only an operator-controlled installation of that exact protected grant admits the map. A different map requires another reviewed root-policy assignment and new signed request; an application profile update cannot expand it. Jiggle thresholds remain a separate reviewed profile choice.

The new policy explicitly admits **`Restart=on-abnormal` for this peripheral service only**. It does not change the web policy's `restartAutomatically=false`. Normal configuration/authentication failures hold; reviewed source-level reconnect uses fresh native/helper identities and held/repeat/stale-input fences. Neither manager restart nor reconnect may start audio, synthesize a musical gesture, or replay an earlier gesture. The fixed runtime only reads evdev and sends validated brightness-only hidraw output, preserving enable masks.

No remote unit enable/disable, linger, ALSA/native-engine spawn, audio on/off, synthetic musical Start/Stop, firmware, device permissions, udev, group, sudo, SSH, network, credential, package-install, other-service, or release-deletion authority is added. Disruptive actions require fresh audio-off/idle and known ownership evidence. The named service's stop releases its owned output; it must not call engine Stop or audio-off. Cooperating-controller and known-owner checks are not global owner exclusion or protection from a malicious same-UID process.

Attachment housekeeping uses explicit physical-source admission and exact-owner revocation under native epoch/session/sequence/held fences. It may also configure validated jiggle thresholds while prepared/stopped or as an authoritative identical-values no-op while running. This does not permit a synthetic press, arbitrary controls, or changing jiggle settings during playback.

## Signed candidate schema

`check.py` is standalone and derives its strict JSON, SSH signature, bounded lifetime, flock, replay, and audit machinery from the existing web checker. It intentionally duplicates the small fixed verifier rather than importing mutable code or parameterizing the web verifier.

The outer mailbox content is exactly `{kind, payloadBase64, signature}` with kind `show-tools-peripheral-signed-action-v1`. The payload has exactly:

```text
schemaVersion requestId nonce issuedAt expiresAt
grantId grantVersion grantSha256 targetId action sourceRevision archive
oldProfileSha256 oldUnitSha256 profileSha256 unitSha256
runnerSha256 helperSha256 manifestSha256 sourceReviewSha256 planSha256
peripheralAssignmentSha256 completedWebStage evidence
```

`archive` retains the existing exact session archive origin/path/size schema. It identifies an artifact; it does not authorize a fetch. `completedWebStage` is exactly `{requestId, evidenceSha256}`. It is a signed reference, not self-authenticating proof of a completed stage. The host must look up the actual completed receipt and verify that its source/archive/manifest match this candidate. `peripheralAssignmentSha256` hashes the canonical JSON of the grant's fixed assignment. Evidence is a bounded list of exact `{kind, sha256}` objects.

Null old file pins are allowed only for create-only initial `configure`; an existing file must never be silently accepted in place of signed absence. Rollback needs exact old pins. Start, stop and status must retain identical old/new profile and unit hashes. All digests and the full source revision are mandatory. The request TTL is at most 900 seconds, with the existing 60-second clock-skew bound.

The checker accepts only `inspect ID`, `claim ID`, or `record ID running|completed|blocked|uncertain EVIDENCE_SHA256`. Inspection returns `executable:false`, `hostPreconditions:unverified`, and `sshSourceProvenance:not-attested`. A successful signature is never permission to run arbitrary plan text. Claiming is unique by request ID and nonce. The checker revalidates current policy, signature and time after obtaining the ledger lock. A completed outcome requires a durable running record. Missing, replaced, corrupt, full, or unsafe ledgers fail closed and are never recreated by admission.

`sign.py --plan PLAN --key EXISTING_KEY` signs the exact bounded bytes with the new namespace and emits an ordinary mailbox submission. It performs no transport. Never use the old web namespace or edit its signer file to make the new request pass.

## Host semantic admission and execution

After authentication, the host steward must verify the completed web-stage receipt, all immutable release files and pinned manifest, source review, runner/helper hashes, exact old and new profile/unit, and the fixed `serve --config` argv. Validate the profile's gateway/credential paths, version-two `inputMap` exactly against the protected grant's entire assignment, operator-confirmed jiggle selection, and exact unit policy before mutation. Admission pins the full assignment hash and profile bytes; the host steward must compare their actual contents, not merely their supplied digests. Also verify trusted runtime/interpreter resolution and the effective service environment; authentication does not attest inherited user-manager environment or provide same-UID isolation. A payload hash alone does not perform these checks.

For each disruptive operation, obtain fresh audio-off/idle and service/ownership state. Unknown state holds. Obtain a unique durable claim, record running evidence before mutation, perform a second fresh policy inspection immediately before the exact action, and verify the outcome. Record completed only with its actual postcondition evidence, or blocked/uncertain with retained evidence. Never replay a consumed request to repair an uncertain outcome. Configuration writes use expected-old hashes, no-follow regular files, private byte-copy backups, same-directory atomic replacements, and a stopped-service compatibility boundary; per-file replacement is not a multi-file transaction. Initial absent files use exclusive create-only publication. Do not alter operator-created enablement links.

Starting this service is distinct from audio activation. Check the actual waiting path: the current managed runtime requests only status while audio is off and does not start a helper then. Once an explicitly enabled native session becomes ready, reviewed physical inputs may be delivered under native epoch/session/sequence/held fences. Do not substitute a generic "waiting" label for the source's actual I/O behavior.

## One-time operator bootstrap

Prepare the reviewed local packet with:

```sh
python3 -I lib/peripherals/delegation/freeze.py --input-map /absolute/path/observed-input-map.json --out /absolute/path/new-review-packet
python3 -I -m unittest discover -s lib/peripherals/delegation/tests -v
```

Freeze emits the manifest and active-grant hashes without changing the source template. It refuses an existing output directory or an incomplete, legacy, unconfirmed or invalid map. The no-argument command refreshes source-template hashes only and reports `ready:false` with no active-grant hash. Synthetic test maps are not installation evidence. Data-only staging places `manifest.json`, `check.py`, `grant.inactive.json`, `allowed_signers`, and `bootstrap.py` into one canonical UID/GID 1000 mode 0700 directory below the existing app staging root, with each source file mode 0600. Review exact hashes and readbacks before preparing the operator command.

The final operator command must hash and execute the **same captured initializer bytes**, using a clean environment and Python `-I`, and set its arguments to:

```text
--operator-approved-bootstrap EXACT_PACKET_DIRECTORY MANIFEST_SHA256 ACTIVE_GRANT_SHA256
```

Do not hash a mutable path and then execute that path as root. A bounded stdin loader can receive the initializer through an unprivileged shell redirection, verify its separately reviewed SHA256, and compile those captured bytes. This README deliberately does not contain a runnable root command with stale hash placeholders. The coordinator supplies the concrete command only after independent review and exact staging readback; only the operator executes it.

The initializer captures and verifies all packet bytes before writing. It opens fixed root-owned destination directories without following symlinks, and rejects writable ancestry, including mode 0775. It does not create, chmod, or repair existing directories. It verifies that the new signer retains the existing protected web signer principal/public key while using the new namespace. New checker/signers/inactive grant are create-only, root:root 0644, single-link regular files. It then creates a private UID/GID 1000 ledger genesis in the existing strict mailbox directory, verifies all new files, and atomically activates only the exact reviewed new grant. It never imports packet code, executes app/helper code, starts a service, opens a device, or changes old web policy/history.

On failure, created files and partial evidence remain. No active grant is published before genesis verification. Retrying exact inactive partial publication is allowed; a partial/corrupt ledger, differing protected file, active grant missing its ledger, or used ledger is refused rather than repaired or reset. An immediate identical retry after successful bootstrap leaves file identities and genesis unchanged. Once the ledger has been used, do not rerun bootstrap as a repair tool. Revocation remains an operator root-policy action on this new grant; changing its active flag/version invalidates old signed requests. It must not reset the ledger or alter the web grant.

Tests run without root, host access or hardware. They use real Ed25519 signatures, actual filesystem modes/links/atomic renames/fsync and concurrent audit locks. Bootstrap fixture ownership IDs are adapted to the local test user; production paths and UID/GID policy are unchanged. Tests cover cross-namespace/key/target/policy rejection, expiry/revocation after waiting for the lock, one-shot claims, replaced/corrupt audit state, 0775 ancestry, source drift, partial initialization, and activation failure.
