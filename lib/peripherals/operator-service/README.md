# Proposed one-time peripheral user-service installation

This is a local review proposal, not a host installation or remote grant. The
operator confirmed Escape hold-to-light physically. The web upgrade is separate:
retain its installed d817 CLI and Restart=no policy; this packet never modifies
web files or starts/stops web/native audio.

The packet targets proxmox / anulman, UID and primary GID 1000. The fixed new files
are /home/anulman/.config/show-tools/peripheral.json and
/home/anulman/.config/systemd/user/show-tools-peripheral.service. The only enabled
link is that service under the existing default.target.wants directory. The
existing lingering setting and all parent permissions remain unchanged.

The source renderer's exact unit runs:

    /home/anulman/.local/share/show-tools/releases/session-<PERIPHERAL_SOURCE7>/bin/show-tools-peripheral serve --config /home/anulman/.config/show-tools/peripheral.json

The separate show-tools-session launcher does not expose peripheral commands.
The profile uses the confirmed HTTPS origin, explicit local tailnet route,
existing credential FILE path, SDK output0 and Escape key. It omits caFile so
Node's normal trusted roots, configured hostname/SNI and certificate validation
apply. Binding revision1 initializes a new delivery binding, not a song binding.
The operator selected musical knob actions off for the initial profile. Pass
`--disable-jiggle` explicitly to encode `jiggle:null`; there is no inferred tuning
value. An explicit object remains available for separately approved tuning.

The separately reviewed peripheral release must already be installed at its
fixed-root `session-<PERIPHERAL_SOURCE7>` path. Its full source revision is explicit,
verified against release.json and pinned independently of the existing web source.
The web profile may continue pointing at reviewed d8fa3cf; it is not redeployed
for this controller update. The preparer
pins its Node, both CLI bundles/launchers, native peripheral helper and release
metadata. The final manifest also pins the exact reviewed installed web profile,
installer and complete peripheral profile/unit. All pins are checked before any
service-manager call. No token contents are placed in this packet or output.

The installer validates the explicitly reported user-manager PATH before any
activation. Every PATH directory and its canonical ancestry must be root-owned
and non-writable by group/other; root-controlled /bin symlinks are resolved. The
selected dirname must resolve to a protected root-owned executable because the
pinned release wrapper uses it before selecting Node. An absent manager PATH is
held; Python's default PATH is never substituted. No global manager environment
is changed. Unreviewed NODE_* (except benign NODE_ENV application-mode selection),
LD_*, DYLD_*, OPENSSL_CONF/OPENSSL_MODULES, ENV/BASH_ENV and exported shell-function
variables are rejected by name only, with no environment values in diagnostics.
This is activation-time integrity checking, not isolation from a malicious same
UID changing its own files or manager environment afterward.

The installer runs only as UID/GID1000, checks the actual account/home/private
group, target hostname, caller-owned no-follow directory ancestry, file modes,
no unexpected ACLs, release hashes and existing token metadata. Existing
UID/GID1000 group-writable user directories are accepted only after the private
group check; no parent chmod occurs. Frozen remote-grant/ledger ancestry rules
are untouched. Existing different files, symlinks, foreign unit/drop-ins and
foreign enablement links are held without replacement. Target files are created
with atomic no-clobber publication and mode0600. Exact active reruns are read-only.

Before first activation the installer makes one read-only audio-status request
with the new release's session CLI. Only a fresh `Audio off` response admits initial installation, and a second
fresh off check is required immediately before start. Ready audio is refused even
when idle or ended; the installer never forces audio off. Exact active reruns stay
read-only. It never calls audio on/off, Start or Stop. It reloads the user manager,
enables only show-tools-peripheral.service, and starts only that service. It
checks resulting named unit activity/enablement; that is not proof of USB
qualification or practice-cue acceptance. All standalone bench readers/writers
must have exited before the persistent controller takes over; its named-service
check is not a general board-owner scan.

The controller waits while audio is off, the gateway is unavailable or USB is
absent. Each reconnect has fresh identities and clears the owned output before
replacing the child. Native C++ still owns musical timing and light images. The
unit permits abnormal controller recovery (Restart=on-abnormal, three seconds),
while normal auth/configuration failures hold. No audio lifecycle is restarted.

For final preparation, pass both independent reviewed source revisions, the
actual local web profile and the explicit operator-selected disabled mode:

    node --import tsx lib/peripherals/operator-service/prepare.ts --release REVIEWED_NEW_RELEASE --source-revision PERIPHERAL_FULL_SHA --installer-source-revision INSTALLER_FULL_SHA --web-profile REVIEWED_WEB_PROFILE --web-source-revision WEB_FULL_SHA --disable-jiggle --out NEW_PRIVATE_PACKET

For enabled tuning, both `--jiggle-travel` and `--jiggle-reversal` are required
instead of `--disable-jiggle`; mixing them is rejected. Without a complete
explicit selection and both reviewed source/profile inputs, the preparer produces
only a pending proposal and no
activation command. The final OPERATOR-COMMAND.txt pins both installer and
manifest, runs Python isolated with a closed environment, and must be executed
in the operator's anulman UID/GID1000 shell. If starting in a root console, the
operator must explicitly switch to that user before executing it; this installer
refuses root. It does not install a sudo grant, packages, udev rules or credentials.

Future remote configure/start/stop/status/rollback requires Pi's separately
reviewed fixed-target peripheral sidecar/bootstrap. This packet creates no remote
authority and changes no existing checker, signers, grant or ledger.

Local verification uses owned temporary files and a simulated service manager:
31 checks cover all critical pins before service calls, complete/idempotent
create-only writes, active-service read-only reruns, active-performance hold,
foreign file/symlink refusal, retained private-group0775 ancestry with zero chmod,
exclusive-group rejection, web-profile/token metadata pins, explicit tuning
validation, wrong UID/host rejection and no credential output. No host call,
USB device or audio device is used by these tests. Real activation remains an
operator action after independent review.


Standalone installer revisions are separate from runtime release revisions.
Manifest version2 requires `installerSourceRevision` in addition to peripheral
`sourceRevision` and retained `webSourceRevision`. Supply the explicit installer
commit with `--installer-source-revision`; the preparer verifies its Git blob
against the copied installer bytes. An installer-only correction does not rebuild,
relabel or select the runtime archive's older packaged installer. Packet staging
names include both peripheral and standalone installer source prefixes.

Every regular packet/release/profile/unit read requires a single link, including
fresh exact-existing checks. Existing token metadata must also be single-link.
Nonblocking no-follow opens reject FIFOs/special files before content reads.
Publication fsyncs the temporary content and directory, removes only its own
temporary link, fsyncs the directory again, then independently rereads destination
bytes, identity and mode0600/UID/GID/single-link metadata. Partial failures retain
published data/evidence and hold; linked evidence is never silently repaired.

Trusted command clients capture at most65,536 bytes per stdout/stderr stream,
with bounded reads and a ten-second capture deadline after spawn. Failure cleanup
signals only the owned client session/group with TERM then KILL before reaping,
ignoring repeated TERM/INT/HUP during that cleanup. It makes no service kill or
rollback request. A daemon action may already have applied even if its client
fails, times out, overflows or is canceled; inspect actual status before retry.
The original error/cancellation and any cleanup uncertainty are retained. Process
creation, hard kill, uninterruptible processes and escaped descendants prevent a
general no-orphan guarantee; the bounded cleanup wait reports unconfirmed exit.
