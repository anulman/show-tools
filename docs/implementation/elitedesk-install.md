# Install the persistent EliteDesk desk

This procedure targets the `anulman` user application on the confirmed Proxmox/EliteDesk host. It does not select a VM or LXC, change storage, grant SSH shell access, or change host boot policy. The [session CLI guide](session-cli.md) describes operator commands.

## Establish the installation capability

The restricted SSH mailbox carries requests and evidence. It cannot install files or grant deployment authority. The host steward must recognize either a scoped operator approval for this installation or an installed standing delegation before changing host files.

The approval packet identifies the exact source revision, archive SHA256, compressed byte count, archive root, release path, generated profile and user-unit hashes. It also identifies the operator CLI path, credential migration, rollback, and allowed acceptance checks. Do not treat an expired temporary session as a persistent-service grant.

Initial installation leaves the user unit disabled and user lingering unchanged. Web startup serves the desk with native audio off. Opening a PCM device for an audio-enable acceptance check requires that check in the recognized scope. Never send musical Start as an installation check.

## Inspect and stage the immutable release

Use the reviewed `scripts/stage-session-release.py` from the matching source. Transport the exact archive through the separately reviewed peer-restricted artifact listener. Keep credentials out of the archive and listener.

Run the stager with the archive path, independently supplied SHA256, byte count, full source revision, and canonical private application root:

```sh
python3 stage-session-release.py ARCHIVE SHA256 BYTE_COUNT SOURCE_REVISION /home/anulman/.local/share/show-tools
```

The stager derives archive root `show-tools-session-release-<source7>` and destination `releases/session-<source7>`. It validates the complete manifest, hashes, runtime pin, native provenance, review sources, paths and file types before promotion. It never executes release code or modifies services, profiles, or credentials. Repeating an identical stage verifies the existing release. A different existing release is not overwritten.

Review `release.json`, `SHA256SUMS`, `provenance/source.json`, native compiler/package/runtime-dependency records, and the complete sources under `provenance/source/`. The source record compares reviewed and packaged Git trees and checks native-source equivalence with the CI artifact. Review the full installer ownership/drop-in checks, native lifecycle, identity resolver, and acquisition code before running the CLI.

Peripheral-enabled releases also include `native/peripheral/` with its own source revision, build input hashes, compiler record, and checksums. The bundled `bin/show-tools-peripheral` runs using the release's Node executable. Staging checks its layout and Linux executable without starting it. Device permissions and physical Linux acceptance remain separate installation checks. Older releases without this component retain their original staging contract.

## Provision only the reviewed app paths

Use these confirmed target locations:

- Release `/home/anulman/.local/share/show-tools/releases/session-<source7>`.
- Profile `/home/anulman/.config/show-tools/session.json`.
- Credentials `/home/anulman/.config/show-tools/credentials/{token,tls.crt,tls.key}`.
- Runtime root `/run/user/1000/show-tools`.
- User unit `/home/anulman/.config/systemd/user/show-tools-web.service`.
- Operator launcher `/home/anulman/.local/bin/show-tools-session`, pinned to the reviewed release launcher.

Create private configuration directories with mode 0700 and files with mode 0600, owned by user 1000. Refuse unexpected existing files or links. Validate canonical paths, regular single-link credential sources, ownership, permissions, certificate hostname/chain/expiry, and keypair before privately copying the approved retained credentials. Do not print credentials, rotate them, delete originals, or issue a new certificate implicitly.

Validate the generated profile and unit hashes. The profile uses the exact Solo serial, USB vendor/product, stable control link, ALSA card ID and PCM device from the hardware inventory. Native acquisition resolves current numeric devices from that identity. It checks both acquired handles and the named Direct Monitor boolean switch. The controller checks the specified legacy monitor user service before each fresh enable. No check stops another service or changes a mixer control.

Before starting, recheck that the target is idle and has no active performance. Keep the original dry monitor off. Review user-manager environment overrides before execution; the current unit does not claim environment sanitization or custom resource caps.

Use the pinned release CLI to install the reviewed user unit without `--enable`, then start it. Installation reloads the user manager but starts no service or device. Web start must return authenticated audio-off status. `Linger=no` does not guarantee availability after the last logout or reboot. Enabling autostart or lingering needs a separate recognized host capability.

## Verify and roll back within the grant

For web-only acceptance, verify TLS/static delivery, unauthenticated API rejection, authenticated audio-off state, CLI status, and no Scarlett PCM claim. Refreshing the page must preserve that state.

If native-enable acceptance is authorized, enable audio and verify the selected serial, exact negotiated parameters, stopped native readiness, unity gains, dry profiles, and current PCM ownership. Terminate audio and verify native exit and PCM release while HTTPS stays available. Do not infer physical sound, latency, or xrun performance from readiness.

An explicit operator CLI stop terminates the web service and its native process group without another confirmation. Transport Stop keeps the native engine and takes. Audio off discards takes and keeps the web server. These are separate actions.

Rollback stops only the reviewed named application service and verifies PCM release and listener closure. Restore or remove only the newly installed unit, launcher and profile pointers covered by captured prestate and the grant. Preserve releases and credential originals. Do not enable the legacy monitor or perform broad cleanup.
