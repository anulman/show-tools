# Persistent session CLI

The host CLI manages one named systemd user service from a validated `SessionProfile`. The source implementation is available. No host unit, user lingering, or live hardware deployment is installed by this change.

## Commands

The repository launcher accepts these commands on the configured application host.

```sh
./show-tools session install --profile /absolute/path/session.json
./show-tools session start --profile /absolute/path/session.json
./show-tools session status --profile /absolute/path/session.json
./show-tools session audio on --profile /absolute/path/session.json
./show-tools session audio status --profile /absolute/path/session.json
./show-tools session audio off --profile /absolute/path/session.json
./show-tools session stop --profile /absolute/path/session.json
```

Without `--profile`, the CLI reads `$XDG_CONFIG_HOME/show-tools/session.json`. If `XDG_CONFIG_HOME` is absent or relative, the configuration directory defaults to `~/.config`. A missing or invalid profile fails without choosing a target. The profile schema in `lib/remote-performance/session-profile.ts` defines the required server, package, native, token, and network paths.

`install` writes the named unit under `$XDG_CONFIG_HOME/systemd/user/`, with the same `~/.config` fallback. It then reloads the user manager. Repeating installation accepts identical content. Installation refuses a different existing unit, and start or stop refuses a foreign loaded unit or drop-ins. Upgrades require a separate reviewed replacement. Installation starts no server and opens no audio devices.

`install --enable` explicitly enables the unit for future user-manager starts. Installation never changes user lingering. Start and status report the host's `Linger` value. `Linger=no` does not guarantee survival after the last logout. That persistence needs a separately provisioned host setting. An unavailable `loginctl` produces `Linger=unknown`.

`start` starts the named service and waits up to approximately 30 seconds for authenticated `/api/status`. The server starts with audio off. Starting an existing service preserves its current audio and transport. A reachable server outside the inactive named service blocks startup until ownership is resolved. Authentication and TLS failures do not launch another server.

`audio on` enables and prepares native audio, then waits for ready or fault. It sends no musical Start. `audio off` terminates native audio and discards native takes while the web server stays up. `stop` explicitly terminates the web server and its owned native process group, including during a performance. It reports success only after the named service is inactive with no main process or counted tasks. Neither termination command asks for another confirmation.

`status` and `audio status` are read-only. Audio mutation gets one `/api/session`, submits one sequenced `/api/audio` request, and polls `/api/status`. Polling does not allocate more client sessions. Requests use the profile origin and private token internally. Tokens never appear in child arguments or CLI output. Token files must be regular files owned by the current user with no group or other permissions. HTTPS clients use Node default certificate roots unless the profile explicitly supplies `caFile` for a custom CA bundle. The server `tls.cert` and `tls.key` configure only the HTTPS listener; a server fullchain without its root is not a client CA bundle. Hostname verification remains enabled. An optional literal-IP `connectAddress` routes app requests directly to that address while retaining the configured origin in Host, Origin, SNI, and certificate checks. HTTP overrides must remain loopback. Omit it to use normal origin resolution.

## Installed runtime

The user unit executes the profile's absolute `server.nodeExecutable` and `server.entrypoint`, followed by `--profile` and the canonical profile path. The entrypoint is the standalone managed server bundle. Unit arguments escape systemd environment and specifier expansion. Paths with control characters are rejected.

The rendered unit uses `KillMode=control-group` and a 15-second stop deadline. The profile selects `Restart=no` or `Restart=on-failure`. With `on-failure`, `RestartSec=3s` spaces retries and `StartLimitIntervalSec=0` lets them continue while the listener address is unavailable. There is no maximum session runtime. The user manager owns the server after the invoking CLI exits. The server owns native audio. The CLI never supervises a second native process.

With `on-failure`, the user manager retries a failed web startup or process. Each
new server starts with audio off; the policy never restores audio or transport.
A native-audio fault while HTTP remains running does not restart the web process
or automatically re-enable audio. Explicit `session stop` remains stopped. The
CLI readiness deadline still reports an unavailable server; manager retry can
continue afterward. This policy changes neither listener addresses nor network
configuration, and a healthy active performance is not restarted.

Changing the profile's restart policy also changes the rendered unit. The CLI
checks that the installed unit matches and requires a separate replacement
when the content differs. Verify address readiness and service startup on the
target machine after applying the change.

## Start the desk on a local network

For unattended boot, enable the named user unit and verify that the service account has `Linger=yes`. If the desk must start without Tailscale, configure `host` as a stable address on the local interface. With `restartPolicy` set to `on-failure`, systemd can retry if the local address arrives after the user manager starts.

Set the session and peripheral `connectAddress` to the reachable local address. Keep `origin` at the exact HTTPS origin the browser uses. The browser needs its own offline way to resolve that hostname to the desk, and each device must trust the certificate for that name. A single configured listener binds one address. If you switch it from the Tailscale IP to a LAN IP, arrange a separate route for any clients that still need Tailscale access.

After an authorized configuration change, verify that the service is enabled and fetch authenticated status with the installed CLI. To prove boot behavior, boot the machine with Tailscale unavailable and check the current boot's user unit journal. From the laptop or phone, open the configured HTTPS origin on the LAN and confirm the desk reports audio off. Check the physical buttons with audio off before enabling audio for practice.

`scripts/session-cli.ts` is a standalone bundle entry for a deployment package. It accepts the session subcommands directly, such as `start --profile FILE`. `scripts/show-tools.ts` imports the session command implementation on demand. Existing chart and Sheets commands remain separate.

The release also includes `bin/show-tools-peripheral`, which accepts the existing peripheral subcommands directly. Its private configuration names the installed `native/peripheral/peripheral-host` executable, gateway origin, token file, optional certificate, confirmed output channel, and binding revision. Run `bin/show-tools-peripheral connect --config FILE` after enabling native audio and leaving transport stopped. The bridge starts no audio and needs a new connection after the engine attempt changes. See the [peripheral guide](../../lib/peripherals/README.md#persistent-mac-device-host) for the configuration schema.

## Verification

The process tests run the real CLI with an isolated XDG configuration directory, fake `systemctl` and `loginctl`, and authenticated loopback HTTP. They exercise a fake managed server that survives the invoking CLI process and ends on stop. They never contact live DBus or audio hardware.

```sh
node --import tsx --test lib/remote-performance/tests/session-cli.test.ts
npm run typecheck
```

If the desk remains stopping with an unconfirmed-cleanup diagnostic, do not repeatedly Enable audio or treat a page reload as device cleanup. A startup that requested a child but never received its handle remains uncertain even if delegated cleanup returned. Use the configured managed-service recovery and confirm the entire owned process group has exited before starting again. This conservative state can also follow an ambiguous spawn failure; it is not an automatic restart path.

Actual systemd group cleanup and physical audio-device release require the verified deployment handoff on an explicitly assigned idle host.

## Managed ALSA admission

An ALSA driver profile supplies `identity` with `byId`, `usbSerial`, `usbVendor`, `usbProduct`, `alsaCardId`, `pcmDevice`, and `monitorOff`. Vendor and product are four lowercase hexadecimal digits. `monitorOff` names a MIXER BOOLEAN with one value that must be off. Capture and playback device strings are derived from the identity, rather than independently configurable aliases. Fake audio remains a separate driver variant.

The optional `requireInactiveUserService` accepts only the known legacy `scarlett-monitor.service`. On each fresh ALSA enable, the controller reads its user-manager state and requires loaded, inactive/dead, MainPID zero and an empty control group. Missing, partial, active or unreadable state refuses enable. The bounded, cancelable check never stops or changes that service. Fake audio does not contact systemd for this check.

Native code verifies serial and Direct Monitor at device acquisition, including the actual opened PCM handles. It never changes mixer state or falls back to another card. Unknown identity, a busy device or an enabled monitor produces an audio fault while HTTP remains available. Repeated Enable while audio is already ready preserves that engine and its takes.
