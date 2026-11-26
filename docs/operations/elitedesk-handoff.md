# Prepare the native audio host handoff

The native host, control gateway, and remote performance desk are implemented. Hardware mode lets a laptop or phone control one native instrument while audio remains on the EliteDesk. Browser mode keeps the existing local WASM practice path. Implementation and synthetic verification do not establish an installed or approved live deployment.

The operator authorizes autonomous development through merge. The restricted SSH mailbox grants messaging only. Host installation, guest or network changes, dry-monitor takeover, and live audio still need a concrete plan and operator approval.

## Track implementation and device verification separately

- [x] Collect a bounded, read-only EliteDesk inventory through Pi's existing access.
- [x] Implement the native engine owner, fake PCM host, ALSA device path, and private Unix socket.
- [x] Implement the authenticated gateway and the desk's Hardware and Browser modes.
- [x] Verify synthetic PCM, native IPC, gateway commands, and remote-session regressions locally.
- [x] Verify the native foundation on Linux and macOS CI in [PR #103](https://github.com/anulman/show-tools/pull/103).
- [x] Complete integrated remote-feature CI and the actual browser acceptance run in [PR #105](https://github.com/anulman/show-tools/pull/105).
- [ ] Select a reviewed release revision, staging route, runtime, and device configuration.
- [ ] Obtain approval for installation, the exact dry-monitor takeover, and the live device test.
- [ ] Verify real capture, playback, frame continuity, restart, and reconnect against agreed limits.

The integrated local verification includes 13 passing native CTest tests and a full suite with 593 passing tests and two explicit skips. Linux and macOS CI pass. An isolated Chrome run passes eight desktop and 390px phone-layout checks, including native controls, effects, natural completion and replay, mode switching, controller detachment, and gateway restart. Hardware mode makes no browser audio, microphone, or WASM calls. These checks use a synthetic native host and do not open a Scarlett or test an actual phone over Tailscale.

## Keep ownership at the implemented boundaries

| Component | Implemented responsibility | Verification limit |
| --- | --- | --- |
| `lib/performance/` | Shared C++ clock, transport, chart actions, capture, playback, mixing, click, and effects | Native and WASM fixtures do not establish device deadlines. |
| `lib/native-host/` | Persistent instrument, one audio owner, commands, copied observations, and private socket | `native_fake_host` uses synthetic input; `native_alsa_host` requires explicit installation settings. |
| `lib/native-alsa/` | ALSA capture and stereo playback, selected input channel, PCM conversion, bounded transfers, and device lifecycle | Simulated boundary tests open no physical hardware. |
| `lib/remote-performance/` | Authenticated HTTP commands, SSE observations, static desk serving, and native socket connection | It is a control gateway, not an audio engine or a musical scheduler. |
| `ui/practice/` | Hardware mode attaches to the host; Browser mode uses local WASM | Hardware mode does not construct browser audio, acquire a microphone, or record a browser demo. |

The gateway validates the song manifest, regenerated native packet, and explicit six-profile effects before stopped preparation. The native owner preserves the current instrument if replacement preparation fails. See [the development guide](../development.md#verify-the-remote-practice-instrument) for packaging, preparation, and test commands. Release artifact packaging and transfer belong to the later deployment step.

Clients observe the host's current song and applied state. Attaching, refreshing, or detaching a client does not stop or reconfigure the instrument. The mode selector reloads the desk and blocks switching while Browser audio is busy. Leaving Hardware mode only detaches that browser.

Commands return the native owner's applied result. Process epoch, run identity, and publication revision distinguish current state from stale observations. A lost connection can leave an in-flight result unknown. Neither client nor gateway replays that action. Reconnection obtains current state rather than reconstructing musical time from network receipt.

The existing relay under `lib/relay/` remains separate from this gateway. The remote desk does not depend on its producer lease or its port defaults. Physical keyboard and I-PAC integration, Video clock delivery, and a configured database sidecar remain separate work.

## Preserve the audio contract

One owner calls `pf_process_stems()` with mono float microphone input and four caller-cleared, nonoverlapping planar outputs. These contain sample/click left and right plus processed-live left and right. The host mixes those stems once into stereo device output. It does not add a parallel dry monitor. C++ advances time and executes musical decisions.

The ALSA host requires explicit capture and playback names, sample rate, format, capture channel count, microphone channel, maximum block size, period size, and buffer size. It disables ALSA rate resampling and rejects unsupported parameters. Stable device identity replaces an assumed card number or `default` device. See the [native host guide](../../lib/native-host/README.md) and [ALSA guide](../../lib/native-alsa/README.md) for the actual interface and dependency license.

Preparation allocates while stopped. Processing uses prepared buffers, retains unwritten output across short writes, and publishes copied records outside the audio owner. Natural completion writes the final block and drains device playback before accepting another Start. Stop and Panic discard pending output, including during that drain. Device errors terminate the host; automatic device reopening is not implemented.

No production CPU reservation, RT priority, affinity, locked-memory budget, buffer size, or latency target is approved. Preserve engine frame, sample rate, sequence, epoch, and run evidence during device tests. Chart position wraps and is not a monotonic clock. The implemented control protocol does not establish a synchronized Video or network clock protocol.

## Use the bounded inventory without filling its gaps

Pi completed `handoff-001` and `handoff-002` with read-only commands under existing access on November 5, 2026. The following facts are Pi-reported observations, not measurements performed directly by this Codex session.

| Area | Reported observation | Remaining limit |
| --- | --- | --- |
| Machine | Bare-metal `proxmox`, HP EliteDesk 800 G4 DM 35W, Debian 13, Proxmox VE 9.2; i5-8500T with six cores and about 16 GiB RAM | Momentary free memory is not reservation accounting or an approved workload allocation. |
| Storage | One 238.5 GiB NVMe disk; 40 GiB ext4 root and an LVM partition with a visible thin pool; 208 GiB of visible virtual guest disks | Privilege failures leave storage IDs, thin data and metadata occupancy, and physical free capacity unverified. VM or LXC compute is a separate choice from LVM storage. |
| Guests and backups | Six running container units were visible; full guest configuration and backup queries were denied | Current allocations, USB assignments, backup schedule, successful guest backups, and restore readiness remain unknown. No guest is selected for show-tools. |
| Scarlett | Solo 3rd Gen `1235:8211`, host `snd_usb_audio`; stable by-id name is visible; advertised stereo `S32_LE` includes 48 kHz | Earlier Pi-session full-duplex bring-up is not production-host verification, measured latency, or sustained xrun evidence. |
| Build tools | No compiler, CMake, Git, or ALSA development headers on the node | Linux CI supplies build evidence, not a target-node toolchain or authorized installation. |
| Runtime | Pi's user-local Node v22.23.3 exists; no Docker or Podman runtime was found on the node | Do not silently depend on Pi's managed runtime or assume guest-runtime capabilities. |

The gateway's Node executable and dependency installation need a reviewed runtime choice. Select the release revision from the integrated, tested branch. The canonical MusicXML path from [PR #104](https://github.com/anulman/show-tools/pull/104) is integrated and tested; historical unmerged compiler references are not deployment revisions. Linux CI retains its tested host binary with source revision, compiler and package versions, runtime dependencies, license notices, and checksums. A deployment also needs the matching gateway and UI package.

The mailbox is not an artifact channel. A separately approved pull or transfer route, immutable release identity, hashes, dependency manifest, and Linux build provenance are still required before staging executable code. Do not send binaries or credentials as mailbox content.

## Review dry-monitor takeover before executing it

Pi identified `scarlett-monitor.service` in user `anulman`'s systemd manager. During inventory it was inactive, dead, and static, with no lingering user manager. Its wrapper is `/home/anulman/.local/bin/scarlett-monitor`; its Python implementation is a temporary dry monitor, not the production host. Pi observed Direct Monitor off and both ALSA streams stopped. Unprivileged process visibility does not establish global exclusive ownership.

For an approved live test, first capture the current service and hardware state again. The proposed wrapper commands are `scarlett-monitor status` and `scarlett-monitor off` at that absolute path. Confirm device release before starting the selected native host. For rollback, stop that exact host, verify device release and Direct Monitor off, and restore the prior monitor state. Run `scarlett-monitor on` only if restoring the captured state requires it and the operator confirms safe output volume. Do not invent a future engine service name.

Software Stop cannot mute independently enabled physical Direct Monitor. Keep one processed-live route and test Stop and Panic before increasing output level. Service installation, enabled state, autostart, user-manager lifetime, and restart policy remain deployment decisions.

## Establish Tailscale access first

The initial access plan uses Tailscale. Pi reports DNS name `proxmox.tail54fc55.ts.net` and a matching `CertDomains` entry. That is capability information only. This work has issued no certificate and installed no gateway listener. The report does not establish a reachable performance URL.

The gateway accepts explicit bind address, port, allowed origin, token-file path, static-root path, and optional certificate and key paths. Select those values in the deployment proposal and verify HTTPS and authentication from the actual laptop or phone. Keep secret values out of the handoff and mailbox. LAN access is a later phase; its endpoint, trust, and network policy are unselected. Do not change Proxmox management networking or reuse unrelated homelab credentials.

## Finish with a real practice session

After release and takeover approval, demonstrate remote Start, pads, signed knob movement, effects edits while stopped, and Stop or Panic against the actual native audio host. Confirm microphone channel selection, stereo routing, one processed-live path, and no browser audio or dry-monitor process. Verify actual frame continuity and xruns under the agreed workload, then exercise disconnect, host exit, and restart behavior before enabling autostart.

Operator authoring data still needs a consistent SQLite backup independent of Git and a tested restore. Host, destination, cadence, and retention remain unconfigured. Browser demo recording and MP3 export do not imply a native recording service. Follow [the retention policy](../data-retention.md).

To enable automatic copying of Hardware-mode WAVs, set the session profile’s optional `recordingArchiveRoot` to an absolute path on persistent EliteDesk storage. Create the dedicated directory with mode `0700` and ownership matching the desk service user before starting the service. Keep it separate from the static root, runtime root, and authoring data. Verify a completed WAV and its saved receipt survive a gateway restart. Host copies remain after acknowledgement. Monitor free space and remove a host copy only after confirming the Mac copy.

Hardware Manager coordinates the physical installation and operator decisions. Hardware - EliteDesk owns host inventory, device adapters, deployment packaging, and recovery. Performance Engine owns shared C++ semantics, ABI, song compilation, and clock contracts. Chief coordinates reviewed integration artifacts. Pi coordinates on-device infrastructure and prepares scoped actions for operator approval.

## Proposed retained consent bootstrap

The [reviewable delegation source](../../lib/remote-performance/delegation/README.md) provides an inactive grant, frozen candidate verifier and operator-only installation procedure for `proxmox/anulman/show-tools-web`. No host grant is installed or activated by repository changes. The proposed process keeps the current mailbox and SSH boundary unchanged. The operator must approve and activate its exact conditional scope once; future matching signed requests still require actual host preflight, one-shot claims and explicit completion replies. Native acceptance, unit enable and linger remain excluded.
