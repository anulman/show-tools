# Switch CAD workstreams in the desk

Open <http://127.0.0.1:3940/> and select **Arcade button**, **Disco ball**, or **All controls**. The tabs publish the selected workstream into the embedded OCP Viewer. The page shows a building state while preparing a preview. Orbit, clip, and inspect the model as before, then send Scrawl feedback to the CAD coordination session.

All controls places the current arcade button and disco assembly on the same Z=0 desk plane. Only horizontal placement changes. The button reference uses its original 5° mounting pose, including the upstream invalid solid; it is not fabrication geometry. The translucent ball is an illustrative open spherical surface. Its equal sections use the original bar's maximum fitted width at its original root and far end; those shaped endpoint profiles themselves have different radii. The dome, shell thickness, and actual ball fit are not measured or approved.

The desk and OCP Viewer are separate local processes. Keep the existing viewer on port 3939 running. Start the desk from the repository root:

```sh
hardware/cad/cad desk --disco-step '/absolute/path/to/Disco Ball.step'
```

`SHOW_TOOLS_DISCO_STEP` can supply the private STEP path instead. The desk binds to `127.0.0.1:3940`. `/viewer` is an alias for its root page. The original OCP page remains available at <http://127.0.0.1:3939/viewer>. Closing the page does not stop either process. Stop the desk with Ctrl-C in its terminal.

The launcher checks `ui/cad/app.ts` with its local TypeScript configuration and bundles it with the repository's installed esbuild. The generated JavaScript is ignored under `hardware/cad/build/desk/`. It then starts `hardware/cad/desk_server.py` with the isolated CAD Python. No application audio build is needed.

## Publication ownership

The server calls `hardware/cad/workspace.py` with a fixed workstream identifier. It accepts no browser-supplied paths or command arguments. The private reference path is configured at startup and remains outside Git. Desk shutdown and publication timeout terminate and reap the active publisher child. A single publication lock prevents two desk requests from building over one another. An overlapping request fails with a retry message; it does not queue a later overwrite. The tabs disable while their request is pending and change selection only after a successful publish.

Refreshing the page reloads the embedded viewer and republishes the selected workstream after that viewer loads. Switching workstreams fits an isometric view. Rebuilding the same workstream keeps its camera. Selecting a tab again rebuilds its latest source.

While using the desk, coordinate agent publication through this page. The older explicit CLI commands remain available, but they do not share the desk's request lock or its selected-tab state. Workers continue headless work and never publish independently.

## Verify the UI

```sh
node_modules/.bin/tsc --project ui/cad
bash -n hardware/cad/cad
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/check_desk.py
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/check_all_controls.py --step '/absolute/path/to/Disco Ball.step'
```

Check all three tabs against the real viewer, including the building state and keyboard focus. Confirm a missing private reference produces an error and that another tab can still be selected. Backend publication requests require the desk's exact local origin and host; unknown routes and nonempty request bodies are rejected. The desk serves only its page and bundled script, with no file-serving route for private CAD assets.

Concept, fit, and print-readiness labels remain visible in the model and footer. A successful tab switch proves visible delivery only, not physical fit or manufacturing readiness.

See [verification.md](verification.md) for actual browser and backend observations and their limits.
