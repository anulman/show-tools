# Prepare the native audio host handoff

The EliteDesk needs a native audio adapter before it can run the shared engine against an audio interface. The operator's milestone is a performance desk served locally by the EliteDesk, reachable from a laptop or phone, with all audio on the EliteDesk. The operator authorizes autonomous development through merge. This handoff defines the work and evidence required for that adapter. It does not authorize installation, guest changes, service changes, or live audio.

## Track completion in verified steps

- [x] Read the current architecture, hardware inventory, and native engine contract.
- [x] Build the native library and run its seven CTest tests on the Mac baseline.
- [x] Verify the restricted mailbox host key and receive an explicit reply to `hello-001`.
- [ ] Collect the physical host and Proxmox inventory through the on-device agent.
- [ ] Implement and test the device adapter in an isolated checkout.
- [ ] Review an integrated source revision, device routing, recovery, and resource proposal.
- [ ] Obtain authorization for dry-monitor takeover and the live device test.
- [ ] Verify real capture, processing, playback, restart, and reconnect against approved limits.

Use higher rigor for device ownership and host changes than for repository edits. A successful fixture or relay startup cannot satisfy the real-device step. The throughput checkpoint is to resolve machine identity, existing workloads, and audio ownership first, then build the smallest full-duplex adapter. Keep UI work and network delivery out of that first audio milestone.

## Identify the source and deployment status

The repository is `git@github.com:anulman/show-tools.git`, also available as `https://github.com/anulman/show-tools`. Use separately authorized repository access. Do not send credentials through the mailbox.

The local native build baseline is `d7cbde29b2c5469e5bde7e78d29658be43d6dcea`. Chief reports that GitHub main `1db0898afa49a1b45997c295d09ac3c66643deeb` contains the same engine with later documentation and skill changes. Verify the selected revision when preparing an artifact. Neither revision supplies a live device service.

Performance Engine supplied `fd8e53fe55acc9aa81dbbd4d429a57bf914b32f3` as an unmerged MusicXML compiler reference. It is not an approved deployment revision. Inspect its `docs/implementation/musicxml-cutover.md` for the proposed canonical song handoff, but do not silently substitute it for main. Chief, PE, and Hardware Manager must select and test an integrated source revision before deployment.

Read `AGENTS.md`, `docs/architecture.md`, `docs/development.md`, `docs/hardware-inventory.md`, `docs/data-retention.md`, and `lib/performance/README.md` at the selected revision. Shared C++ owns musical decisions and DSP. Browser UI stays under `ui/`; device services belong under `lib/`. Commit verified milestones. Do not start operator-managed Sheets or Chrome CDP services. The local-server milestone supersedes the older workstream instruction to host the web UI elsewhere.

## Separate existing targets from missing services

| Component | Verified source state | Startup or build contract |
| --- | --- | --- |
| `performance_engine` | Reusable native C++ library | Build with CMake 3.20 or newer and a C++17 compiler using the performance guide. It has no service startup command. |
| `compiled_song_host` | Offline synthetic test executable | It verifies compiled instructions and PCM. It has no ALSA backend. |
| Native audio adapter | Missing | Backend, daemon entry point, service unit, packaging, and restart policy require implementation and review. |
| Practice desk | Browser WASM instrument; remote mode needs implementation | Build with `npm ci` and `npm run build`. `npm start` serves static files on loopback port 8082. The new milestone serves controls locally from the EliteDesk without browser audio. |
| Relay | Optional standalone API, unused by current practice | `npm run start:relay` defaults to loopback port 8082. Its native producer is missing. This is not a deployed clock contract. |
| Database sidecar | Target ownership, not a running authority service | Destination, migration, synchronization, and independent backup remain separate work. |

The baseline contains no Dockerfile, Compose deployment, or systemd service file found by the inventory search. Do not invent container startup commands. Node and Emscripten are browser/compiler tooling dependencies, not requirements for a C++ audio callback. The manual native engine excludes aubio and libsndfile.

## Preserve audio and clock ownership

One local engine owner calls `pf_process_stems()` with mono float microphone input and four caller-cleared, nonoverlapping planar float outputs. These are sample/click left and right plus processed-live left and right. Mix the two stems exactly once into stereo device output. `pf_process()` discards the live stem and is insufficient for this monitoring path. Never add a parallel dry monitor.

Use the negotiated device sample rate when creating the engine. Select the confirmed physical microphone channel explicitly. The adapter owns device enumeration, format conversion, routing, and audio IO. C++ owns clock advancement, transport, sequencing, capture, playback, mixing, click, and effects. No network or wall-clock beat scheduler may advance the performance.

Prepare songs, racks, capture banks, and scratch storage before processing. Scratch must cover the negotiated maximum block size, and each call passes the actual frame count. There is no fixed hardware requirement for 128 frames. The audio path must avoid allocation, reclamation, logging sinks, file IO, and blocking network IO. Apply controls through the owning thread and publish copied event records through a bounded queue outside audio processing.

Preserve original sequence, frame, sample rate, run, and epoch evidence. Chart positions wrap and cannot substitute for a monotonic clock. Define overflow, stale-command, fault, and reconnect behavior with PE. Network protocol, presentation latency, and transport cadence remain unselected.

## Record device evidence without promoting it to a latency claim

The explicit `hello-001` reply reports Debian 13 with Proxmox and a Scarlett Solo 3rd Gen using host `snd_usb_audio`. Pi reports working ALSA capture, playback, and full-duplex bring-up at 48 kHz, `S32_LE`, and two hardware channels. It identifies microphone input 1 and stereo output. These are Pi-reported facts, not measurements performed by this Codex session. Confirm the machine's identity and its relation to the EliteDesk before using them as EliteDesk inventory.

Use stable device identity rather than an assumed card number or default device. Pi reports a temporary dry-monitor user service that currently uses the hardware. Its exact unit, account, invocation, configuration, and stop/restart procedure are still unknown. Query them read-only. Before takeover, obtain authorization, stop that exact service, confirm hardware release, and start only the approved engine. For rollback, stop the engine and restore the captured prior service state. Do not execute that sequence until the operator approves the concrete commands.

The production backend, requested and negotiated period, buffer size, PCM conversion, output clipping policy, xrun recovery, disconnect behavior, and sample-rate fallback policy need implementation evidence and review. No measured CPU minimum, RT priority, affinity, governor setting, locked-memory budget, or latency target exists in this handoff.

## Declare ports, data, and secrets only when used

The proposed native adapter has no implemented network listener. The existing optional relay uses `SHOW_TOOLS_TOKEN` and optional TLS certificate and key paths. Secret names and configuration roles are enough for a handoff. Do not send secret values. Neither the relay nor static server default port establishes the production network layout.

Compiled artifacts and capture buffers belong to the selected engine run. Operator authoring data needs an independent, consistent SQLite backup and a verified restore. Host, destination, cadence, and retention remain operator decisions. Live PCM capture and demo export persistence are separate from authoring data. Do not infer that browser MediaRecorder or MP3 export exists in the native host.

## Prove the smallest practice session

First prove a repository-only adapter path that loads a validated program while stopped, prepares authored voice graphs, and processes explicit input through capture, commit, playback, and Stop. Verify input-channel conversion, stereo stem summation, frame advancement, command ordering, invalid-load preservation, bounded publication, and fault handling without devices. Keep this test independent of a network relay.

After the operator approves the live test, use the recorded interface identity and negotiated parameters. Demonstrate microphone input through the native effects route, chart-driven capture and playback, click, and Stop or Panic. Verify that output contains one processed-live path, with no parallel dry-monitor process. Measure xruns and frame continuity under the approved workload. Exercise disconnect and restart against the reviewed policy before enabling autostart or network clock delivery.

Local baseline evidence is the Release build and seven passing CTest tests in `/private/tmp/show-tools-elitedesk-native-check`. This verifies Mac PCM processing only. Linux builds, real-device capture/playback through the production adapter, CPU and memory sizing, callback deadlines, restart, reconnect, and network delivery are not yet verified.

## Assign the owners

Hardware Manager coordinates the physical installation and operator decisions. Hardware - EliteDesk owns read-only host inventory, Proxmox and storage planning, the device adapter, deployment packaging, and host recovery. Performance Engine owns shared C++ semantics, ABI, song compilation, and clock contracts. Chief selects the reviewed integrated deployment artifact. Pi owns on-device infrastructure coordination and prepares privileged actions for operator approval. The restricted SSH key grants mailbox access only.
