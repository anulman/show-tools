# Inventory the EliteDesk before deployment

Use the authorized on-device agent to collect the facts below before choosing a compute guest, allocating storage, or connecting live audio. These commands query Linux and Proxmox. Run each available command separately, record failures, and leave missing tools uninstalled during inventory. Keep raw host reports outside Git and remove credentials from reports before sharing them.

## Establish access and machine identity

Confirm the agent endpoint, host address, login, and whether the agent runs on the Proxmox node or inside a guest. A guest cannot establish the node's physical inventory. Record the collection time and hostname with each report.

```sh
date -u
hostnamectl
uname -a
id
pveversion -v
lscpu
free -h
dmidecode --type system --type memory
```

Use existing authorized privileges. Record permission failures instead of changing access configuration. Capture the actual EliteDesk model, CPU topology, installed RAM, and kernel before proposing resource reservations.

## Map disks and storage ownership

```sh
lsblk -e 7 -o NAME,TYPE,SIZE,MODEL,FSTYPE,MOUNTPOINTS
findmnt
df -hT
pvs
vgs
lvs -a -o lv_name,vg_name,lv_size,segtype,data_percent,metadata_percent,pool_lv,devices
pvesm status
cat /etc/pve/storage.cfg
zpool status
zpool list
zfs list
```

Treat an absent ZFS tool as an observation, not a request to install it. Match each configured storage ID to its backing disk, filesystem, volume group, or remote destination. Record both allocated guest capacity and physical free space. For thin pools, record data and metadata occupancy separately. Query existing disk-health tools only after identifying the relevant devices. Do not run destructive tests, partition tools, or filesystem repair.

A VM or LXC container supplies a compute environment. LVM and LVM-thin supply storage that can back guest disks. These are separate choices. Proxmox records storage configuration in `/etc/pve/storage.cfg`; LVM-thin is local block storage. See the upstream [storage documentation](https://github.com/proxmox/pve-docs/blob/master/pvesm.adoc) and [LVM-thin documentation](https://github.com/proxmox/pve-docs/blob/master/pve-storage-lvmthin.adoc).

## Inventory guests and recovery paths

```sh
qm list
pct list
pvesh get /cluster/resources --type vm --output-format json-pretty
pvesh get /cluster/backup --output-format json-pretty
```

For each discovered guest, query `qm config VMID` or `pct config VMID` using its actual ID. Record CPU and memory allocation, disks, boot policy, network bridge, device assignments, and backup inclusion. Redact secret values from guest configuration before returning a report.

List backup volumes with `pvesm list STORAGE_ID --content backup` for each discovered storage that supports backups. Record the latest successful backup task and any restore-test evidence. A configured backup job does not establish a successful backup. A snapshot or another copy on the same physical disk does not establish recovery after disk loss.

Operator authoring data needs a consistent SQLite backup independent of Git and a tested restore, as specified in [the retention policy](../data-retention.md). The backup destination, cadence, retention, and authority host remain operator choices. Current takes have no default archival requirement.

## Identify audio, USB, and network ownership

```sh
lspci -nnk
lsusb
lsusb -t
cat /proc/asound/cards
cat /proc/asound/pcm
aplay -l
arecord -l
ip -br address
ip route
bridge link
ss -lntu
timedatectl
```

Record missing ALSA utilities without installing them. Match any audio interface and I-PAC to its physical USB path and existing guest assignment. Identify the device owner before opening it. Enumeration does not verify capture, playback, channel routing, monitoring safety, or stable reconnect identity. Do not start USB listeners, play sound, or send LED writes during unattended inventory.

Record NIC link speed with an installed tool, configured bridges, management routes, and active time-sync service. Keep management access distinct from performance event delivery. Confirm which devices host the UI and Video consumer, the actual network path, and acceptable recovery behavior before changing firewall or routing configuration.

## Return a deployment proposal supported by the inventory

1. Report observed facts, failed queries, and unknowns separately. Include existing workloads and recovery constraints.
2. Compare a dedicated Linux VM with exclusive device access against an LXC container using the node kernel. Inspect actual USB ownership, device permissions, kernel support, and scheduling limits before selecting either. The upstream [container documentation](https://github.com/proxmox/pve-docs/blob/master/pct.adoc) describes container storage and device restrictions. Neither option establishes acceptable audio latency without a device test.
3. Propose CPU, memory, disk, and device assignments using measured capacity and the approved audio workload. Preserve existing data and storage pools. Do not resize, repartition, delete guests, or bind devices during inventory.
4. Keep the native audio service, network publisher, and database sidecar responsibilities explicit. Keep browser UIs under `ui/` and host adapters under `lib/`. Coordinate the native host contract with Performance Engine before implementation.
5. Confirm the audio interface, channel routing, required sample rate, latency target, and disconnect policy with the operator. Block dependent device configuration while those facts are missing.

## Verify the engine and then the device host

First run the native build and tests from an isolated checkout using [the performance guide](../../lib/performance/README.md). This verifies PCM processing without opening hardware. It does not verify Linux device access or guest scheduling.

Performance Engine supplied a newer song handoff at `fd8e53f`. It is local, unmerged, and unapproved for deployment. Its `docs/implementation/musicxml-cutover.md` makes `songs/*.musicxml` canonical, with Sheets JSON retained as ingestion archives. Derive native instruction bytes from the validated song model and load them while stopped through `pf_load_compiled_bytes()` or `pf_configure_compiled()`. Preserve authored voice graphs. Coordinate the deployment source revision with Performance Engine and Chief, and derive packet and ABI constants from that revision's headers. This newer handoff is inspected separately from the initial main-checkout verification below.

The future host gives one thread ownership of each engine. That owner applies queued controls, calls `pf_process_stems()`, and drains engine events. Prepare songs, capture buffers, and effects while stopped. Never advance the tracker separately. Copy records into a bounded queue, then serialize and publish outside the callback. Preserve source sequence, audio frame, sample rate, run identity, and drop reporting. Coordinate any added epoch or clock fields with Performance Engine. Network receipt and system time synchronization do not advance musical time.

After the device contract is approved, verify real capture and playback, both stereo stems, measured callback overruns, sustained DSP load, Stop and Panic, device loss, reconnect, service restart, stale commands, and publisher backpressure. Define acceptance limits from operator requirements. Keep deployment readiness separate from successful relay startup or fixture tests.

## Baseline before mailbox access on November 5, 2026

The source inspected was `d7cbde29b2c5469e5bde7e78d29658be43d6dcea` in `/Users/anulman/dev/show-tools`. The required architecture, development, workstream, hardware, and performance guides establish shared C++ ownership and a future live device host. They contain no EliteDesk access endpoint, CPU, RAM, disk layout, guest inventory, audio interface, or backup configuration.

The local SSH configuration has no EliteDesk alias. Local `tailscale status --json` failed to connect to the local daemon. No EliteDesk query, device IO, guest change, or storage change has occurred. Connection details and the on-device agent entry point are the next required facts. No hosting topology has been selected.

An isolated checkout at `/private/tmp/show-tools-elitedesk-admin` built the native Release target with AppleClang 21.0.0. All seven CTest tests passed using `/private/tmp/show-tools-elitedesk-native-check`. This is a Mac software baseline for source `d7cbde2`, not a Linux, Proxmox, device, or MusicXML-cutover verification.

## Mailbox status on November 5, 2026

The operator installed a restricted SSH mailbox. The dedicated key can submit requests and retrieve replies, with no shell or arbitrary file access. Codex verified the supplied Ed25519 server fingerprint and received an explicit completed reply to `hello-001`. That establishes the messaging round trip. Pi's reported audio bring-up remains separate from direct production-host verification. The [handoff](elitedesk-handoff.md) records those reports and implementation gaps. Request `handoff-001` asks for the read-only inventory above. Its latest retrieved status is delivered, with no reply yet.
