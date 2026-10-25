# A CLI for Sheets following

Status: historical README-driven prototype. The implemented interface uses `--no-cdp` and `--skip-open`, accepts a song slug or 1-indexed set-list number, opens `SHOW_TOOLS_SET_LIST_URL` when no song is supplied, and binds the helper before acquiring a browser. See the [current CLI guide](../../scripts/open-chart.md) for commands that run today. The examples below preserve the original proposal.

## Start Sheets following

```sh
show-tools sheets dance-yrself-clean
```

Start a dedicated Chromium browser and the local Sheets helper. Open the song's chart at its lead-in column. Leave this command running while you practice. The practice desk sends subsequent column selections as the sequencer counts.

Proposed output:

```text
Browser   launched Chromium · CDP http://127.0.0.1:9222
Helper    listening http://127.0.0.1:9223
Chart     Dance Yrself Clean · lead-in selected
Waiting for practice events. Ctrl+C stops the helper and the browser launched here.
```

If a compatible browser is already listening at the configured CDP address, reuse it and report that decision. The final line then says that Ctrl+C leaves that browser running.

The command starts no audio, requests no microphone access, and does not start the practice web server. The practice page remains usable without this command.

## Choose what starts and opens

```sh
# Start chart following; let the practice desk choose the chart later.
show-tools sheets

# Use a browser you started yourself. Fail if CDP is unavailable.
show-tools sheets dance-yrself-clean --skip-cdp

# Start services without opening or selecting a chart at startup.
show-tools sheets dance-yrself-clean --no-open

# Attach to another local CDP address; do not launch a browser.
show-tools sheets --cdp http://127.0.0.1:9333

# List the registered songs without launching anything.
show-tools songs
```

An omitted song means no initial chart. There is no implicit favorite or remembered last song. An explicit song opens its chart by default. `--no-open` suppresses only that startup action; later practice events can still open and select charts.

The startup song does not select a song in the practice UI. After startup, each practice event identifies its own spreadsheet and sheet. Changing songs in the UI changes the chart being followed.

`--skip-cdp` means attach to the configured CDP address without launching. It does not disable chart following. `--cdp URL` also implies attach-only behavior. These options never modify or restart the attached browser.

## Proposed help

```text
Usage: show-tools <command>

Commands:
  sheets [song]   Run local Google Sheets following
  songs           List registered song IDs and titles

Options:
  -h, --help      Show help without starting processes
```

```text
Usage: show-tools sheets [song] [options]

Start the Sheets helper and launch or reuse a Chromium CDP browser.
With a song, open its lead-in column. Without one, wait for practice events.

Options:
  --skip-cdp      Require an existing browser at the configured CDP address
  --cdp URL       Attach to this loopback CDP URL; implies --skip-cdp
  --no-open       Skip the initial chart opening; follow later events normally
  --origin URL   Allow an additional practice origin; repeatable
  -h, --help      Show help without starting processes

Examples:
  show-tools sheets dance-yrself-clean
  show-tools sheets --skip-cdp --no-open
  show-tools sheets --cdp http://127.0.0.1:9333

Configuration:
  SHOW_TOOLS_CHROMIUM_APP      Browser app bundle or executable; auto-discovered
  SHOW_TOOLS_CDP_PORT          CDP port; default 9222
  SHOW_TOOLS_CDP_PROFILE       Dedicated profile; default under TMPDIR or /tmp
  SHOW_TOOLS_PRACTICE_ORIGIN   Allowed origin; default http://127.0.0.1:8082

Precedence: command arguments, environment, Bash defaults.
Optional .envrc overrides stay local and ignored by Git.

Ctrl+C stops the helper and any browser launched by this invocation.
Browsers that were already running remain running.
```

The helper remains at `127.0.0.1:9223`, which the practice desk currently expects. Leave helper-port customization out of the first version until the UI can discover or configure it too.

## Lifecycle contract

1. Parse arguments and resolve an optional song before starting anything. Unknown songs and invalid arguments exit with code 2.
2. Validate configuration. Check that helper port 9223 is available before launching a browser. An occupied helper port produces an error; do not silently attach to another helper or kill it.
3. Probe the configured CDP endpoint. Reuse a compatible browser when available. In attach-only mode, an unavailable endpoint produces an error. Otherwise launch the configured or discovered browser and wait for readiness with a bounded timeout.
4. Start the helper. If a startup race claims its port, clean up the browser launched here and report the conflict.
5. Unless suppressed, open the requested song's lead-in once the helper and CDP are ready. This is the only startup action that brings the chart forward. Subsequent automatic following stays in the background.
6. Keep the helper in the foreground. Ctrl+C stops resources this invocation owns. Readiness failures, child exits, and startup chart errors also release owned resources and exit with code 1. Graceful Ctrl+C exits with code 0.

If Sheets needs a sign-in, keep the browser and helper available and report that initial selection is waiting. A bounded wait ends with an actionable error, rather than reporting success without confirmation. Cleanup applies only to the launched browser process; it never deletes its profile or recordings.

No daemon, PID file, background restart loop, or global stop command in this version. No automatic process launch from `.envrc`. Running help or listing songs starts nothing.

## Why this command shape

| Candidate | Example | Assessment |
| --- | --- | --- |
| Extend the npm helper command | `npm run start:sheets -- dance-yrself-clean --skip-cdp` | Smallest delivery step. Useful as a checkout alias, but exposes npm argument forwarding in everyday use. |
| A focused Sheets command | `show-tools sheets dance-yrself-clean --skip-cdp` | Preferred. Names the task and gives the browser and helper one foreground lifecycle. |
| A practice session command | `show-tools practice dance-yrself-clean --no-sheets` | Promising later. Today it implies UI hosting, builds, audio startup, and song selection that the command cannot yet coordinate. |

Keep the CDP launcher and Sheets integration separately testable. The combined command composes them with explicit resource ownership. The existing `npm run start:cdp` can remain an expert tool. A checkout alias for the new command can be `npm run start:sheets -- ...`; choose the executable packaging when implementing it.

Bash continues to supply missing environment defaults and browser discovery. TypeScript parses commands, resolves songs, and manages the lifecycle. Effect scopes are a candidate for cleanup and cancellation when implementation begins. This proposal adds no runtime dependency and changes no current command.

## Decisions to make before implementation

1. **How much should one command start?** Recommendation: only the browser and Sheets helper. A future `practice` command can also host and open the practice page. Starting microphone capture must remain an explicit action in the page.
2. **How should the initial chart be chosen?** Recommendation: an optional song ID, with no implicit default. An alternative is to open Dance Yrself Clean on a bare `sheets` command. Selecting a chart must not silently claim to select the practice UI's song.
3. **Should Ctrl+C close a browser launched here?** Recommendation: yes, with a clear startup ownership message. An attached browser always stays open. If retaining browser tabs after practice matters more, launched browsers could instead remain open by default.
4. **Should startup focus Sheets?** Recommendation: once, when a song is supplied. `--no-open` prevents that. Automatic bar changes continue in the background. Opening the practice page too belongs to a separate decision about session startup.

## Implementation acceptance examples

These are future checks, not claims about implemented behavior:

- `--help` and `songs` create no browser, server, or profile directory.
- A browser path containing spaces works; environment overrides bypass discovery.
- With CDP absent, `--skip-cdp` fails without launching anything.
- With CDP present, default startup reuses it and Ctrl+C leaves it alive.
- With no song, startup creates no chart tab. With a song and `--no-open`, it also creates no chart tab.
- After `--no-open`, a practice event can still open its requested chart.
- An unknown song, occupied helper port, failed browser, or failed initial chart selection leaves no owned helper or browser running.
- Switching songs in the practice UI follows the event's chart rather than pinning the startup song.
- Existing audio practice and downloads work with the CLI absent or stopped.
