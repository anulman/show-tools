# Review enclosure models with Scrawl

Open <http://127.0.0.1:3939/> to inspect the current model. The OCP Viewer runs locally. The agent edits build123d Python source; you orbit, inspect sections, and record visual feedback with Scrawl. You do not need a CAD editor.

The supplied blue mounting wedge, transparent wood, and gold placeholder are a synthetic workflow demonstration. None of their dimensions describe the installed arcade hardware. Only the blue mount is exported for printing. Real mounts require measured component interfaces, wood thickness, fasteners, cable clearances, and a fit test.

## Start or resume

Run these commands from the repository root. Start the viewer in one terminal and leave that terminal running.

```sh
hardware/cad/cad viewer
```

Open <http://127.0.0.1:3939/>. In another terminal, generate and show the demonstration.

```sh
hardware/cad/cad demo --angle 25
```

Each publish rebuilds the model, checks the solid, exports STEP and STL, validates the exported files, and updates the viewer. Camera orientation stays in place. To recover the initial view, use the toolbar's isometric/fit controls or publish with `--reset-camera`.

```sh
hardware/cad/cad demo --angle 15 --reset-camera
```

The viewer serves only on `127.0.0.1:3939`. Stop it with Ctrl-C in its terminal. Closing a browser tab does not stop the server. If the server is already running, use its page rather than starting a second copy. These commands do not start Sheets, CDP, audio, USB listeners, or printer jobs.

## Inspect and give feedback

1. Drag the model to orbit. Scroll to zoom. Use the toolbar's named view buttons for front, top, and isometric views.
2. Use the tree's eye controls to hide the wood or placeholder when either obscures the mount.
3. Open **Clip** to inspect a section. Set a clipping-plane value or drag its slider. Use the Clip panel's **R** to reset all clipping planes.
4. Record a Scrawl of the relevant view. Point or draw on the feature while describing the change. Include a dimension when the change must be exact.
5. For an ambiguous feature, orbit to a second view. State whether the mark concerns the printed mount, wood, or reference component.
6. Send or paste the Scrawl into the CAD collaboration session. Do not rely on automatic routing to an unspecified active session.

Scrawl's contact sheet, frames, and transcript identify the requested changes. The agent must inspect those images before editing. Scrawl is installed on this Mac; its CLI was checked without recording the screen or microphone. The first real feedback capture still needs to come from you.

## Export and verify without a viewer

```sh
hardware/cad/cad check --angle 25
hardware/cad/cad export --angle 25
```

Both commands build and validate the same supplied parameter set without publishing it. Files go to the corresponding parameter directory:

- `hardware/cad/build/demo-25deg/demo-mount.step`
- `hardware/cad/build/demo-25deg/demo-mount.stl`
- `hardware/cad/build/demo-25deg/receipt.json`

The receipt records the source hash, angle, package versions, dimensions, solid count, and mesh checks. Different angles use separate directories. STEP declares millimetres; interpret STL coordinates as millimetres. Headless export does not change the viewer's last published model. To review the exported revision on screen, publish the same angle with `cad demo`.

The checks require one valid positive-volume CAD solid, a matching STEP round trip, and a watertight, consistently wound STL with matching volume. They establish geometric integrity, not measured fit, print strength, material suitability, or a successful physical print. The STL's tessellation tolerance is not a hardware fit allowance.

## Reproduce the installation

The verified environment is outside the app dependencies:

```text
~/.local/share/show-tools/cad/venv
```

This Mac uses `/opt/homebrew/bin/python3.12` to create it. `requirements.lock` pins the CAD packages, including build123d 0.13.0, ocp-viewer 1.2.0, and trimesh 4.12.2. Re-run the setup command if the environment is missing.

```sh
hardware/cad/cad setup
```

`SHOW_TOOLS_CAD_ENV` overrides the environment directory. `SHOW_TOOLS_CAD_BOOTSTRAP_PYTHON` selects another compatible Python 3.12 executable for setup. This does not change the system Python, project Node dependencies, or global Python package selection. Build outputs and caches are ignored by Git.

The CAD engine and viewer are Apache-2.0 projects; trimesh is MIT. The OpenCascade runtime includes LGPL-licensed components with upstream exceptions. These are local CAD-tool dependencies, separate from the musical engine and its browser bundle. Upstream references: [build123d](https://github.com/gumyr/build123d), [OCP Viewer](https://bernhard-42.github.io/ocp_viewer_docs/viewers/ocp_viewer/installation/), and [OpenCascade licensing](https://dev.opencascade.org/resources/licensing).

See [verification.md](verification.md) for the actual geometry, export, browser, and Scrawl checks and their limits.
