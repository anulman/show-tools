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

`status` and `audio status` are read-only. Audio mutation gets one `/api/session`, submits one sequenced `/api/audio` request, and polls `/api/status`. Polling does not allocate more client sessions. Requests use the profile origin and private token internally. Tokens never appear in child arguments or CLI output. Token files must be regular files owned by the current user with no group or other permissions. HTTPS trusts the configured certificate and preserves hostname verification.

## Installed runtime

The user unit executes the profile's absolute `server.nodeExecutable` and `server.entrypoint`, followed by `--profile` and the canonical profile path. The entrypoint is the standalone managed server bundle. Unit arguments escape systemd environment and specifier expansion. Paths with control characters are rejected.

The unit uses `KillMode=control-group`, a 15-second stop deadline, and `Restart=no`. There is no maximum session runtime. The user manager owns the server after the invoking CLI exits. The server owns native audio. The CLI never supervises a second native process.

`scripts/session-cli.ts` is a standalone bundle entry for a deployment package. It accepts the session subcommands directly, such as `start --profile FILE`. `scripts/show-tools.ts` imports the session command implementation on demand. Existing chart and Sheets commands remain separate.

## Verification

The process tests run the real CLI with an isolated XDG configuration directory, fake `systemctl` and `loginctl`, and authenticated loopback HTTP. They exercise a fake managed server that survives the invoking CLI process and ends on stop. They never contact live DBus or audio hardware.

```sh
node --import tsx --test lib/remote-performance/tests/session-cli.test.ts
npm run typecheck
```

Actual systemd group cleanup and physical audio-device release require the verified deployment handoff on an explicitly assigned idle host.
