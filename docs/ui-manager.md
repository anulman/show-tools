# Managed practice UI origins

Build once with `npm run build`, then use `./show-tools ui preview` or `npm start`. The manager imports a verified immutable copy of `dist/` and prints its URL, Git revision, dirty flag, cache hash, and snapshot ID. `preview --build` refreshes browser assets when the checkout already has its generated WASM. A receipt describes the source at build time; a changed checkout does not relabel an old build.

Each real worktree plus optional `--session NAME` owns one durable origin. Assignments use 20000–29999 and remain reserved after stop or worktree deletion, preserving separation of IndexedDB and browser permissions. The initial assignment hashes the identity and resolves conflicts against saved reservations. An unrelated process occupying that assigned port causes an error; it is never killed and no replacement origin is silently chosen.

The live URL is `http://127.0.0.1:8084/ui/practice/`. After fetching and reviewing a merge, run `./show-tools ui live --publish origin/main`. Publication requires an ancestor of the locally known `origin/main`; it builds C++ and UI in a clean detached checkout, verifies the snapshot, and then changes the live pointer. Dependency lockfiles must match the invoking checkout. A failed build leaves the previous publication intact. `ui live` reuses the saved publication.

Opening a stable URL redirects to its immutable release path on the same origin. Existing pages retain their complete release, including dynamically loaded assets and WASM, across later publications and manager restarts. Reopen the stable URL to use the new release. Browser authoring data remains on the same origin. Service-worker installation pins the manifest’s cache identity, cleanup stays within its registration scope, and the existing browser idle activation gate remains responsible for waiting updates. The server does not infer whether practice audio is active.

```sh
./show-tools ui status             # URLs, owner, build identities, blocked listeners
./show-tools ui status --json      # machine-readable registry and runtime state
./show-tools ui stop               # this worktree's default preview
./show-tools ui stop --session demo
./show-tools ui stop --live
./show-tools ui stop --id ID
./show-tools ui shutdown           # all static listeners owned by this manager
./show-tools ui gc                 # conservative retention report; deletes nothing
```

One detached broker owns the static listeners. Its caller-owned private Unix socket is the only mutation interface; HTTP exposes static files and read-only `/__show_tools/ui` status. The daemon bundle is stored independently of its launching checkout. Restart restores enabled registrations; stopped origins stay stopped. Registry reservations, build snapshots, owner records, and logs live under `$XDG_STATE_HOME/show-tools/ui/<repository-id>` (default `~/.local/state`). `SHOW_TOOLS_UI_STATE` selects an absolute base directory. Keep this directory: deleting it discards the record of browser-origin ownership. Automatic origin recycling and release expiry are deliberately absent because tabs may still reference old builds.

For isolated automated tests only, `SHOW_TOOLS_UI_LIVE_PORT`, `SHOW_TOOLS_UI_PREVIEW_FIRST`, and `SHOW_TOOLS_UI_PREVIEW_LAST` override the saved configuration. A different configuration cannot reuse an existing state directory. These are not collision workarounds for practice sessions.

## First handover from legacy servers

`ui status` reports only this manager's registrations. It does not discover or claim other processes. Before first publication on 8084, confirm with the operator that practice is idle, verify the old process's command, working directory, and listener, and stop only that confirmed static server. Preserve its source checkout and browser data. Publish the merged version, open the stable URL, and verify the new `/__show_tools/ui` receipt. Do not stop an active tuner, CAD viewer, deployed gateway, device host, Sheets helper, Chrome/CDP process, or listener of unknown ownership as part of UI cleanup.

The manager never sends signals to foreign listener PIDs. Its startup PID record is only a conservative ownership fence: an alive owner with an unavailable socket blocks recovery rather than being killed. A stale dead owner can be replaced. If the manager cannot validate its private state or saved registry, inspect the reported files and repair the specific problem; do not delete the registry to obtain a fresh port.
