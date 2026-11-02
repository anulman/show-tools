# Tabbed CAD desk verification

Verified on the operator's Mac with the existing CAD Python and project TypeScript/esbuild dependencies. The desk binds only to `127.0.0.1:3940` and uses the already-running OCP Viewer on port 3939.

`tsc --project ui/cad`, the esbuild bundle, Bash syntax, and `git diff --check` passed. The UI is checked as a TypeScript module. The iframe URL is assigned after its load listener is installed. Tabs begin disabled until the initial viewer load and preview build finish.

The real desk served its page and bundle. `/viewer` was added as an alias after the operator naturally changed the port on the old viewer address. Unknown file routes returned 404; POST publication without the local origin returned 403. The reusable `hardware/cad/check_desk.py` starts the actual server on a temporary local listener, checks both page routes and the bundle, rejects foreign origins, invalid models, and request bodies, checks the missing-reference response and unchanged selection, then terminates the temporary server and verifies its listener closed. A second case starts the real publisher with an invalid temporary STEP, observes the child process, and terminates the desk mid-request. It verifies that the publisher is reaped and the request ends. The invalid input prevents geometry publication. It publishes no model. This check passed.

Live server logs recorded successful operator switches from Box mount to Disco bar and back, with successful 204 responses. An overlapping initial publish received 409 while another request was building. The server rejects overlap rather than queuing a future overwrite. The client disables tabs during publication and changes the selected tab only on success. Vivaldi's actual CAD desk showed Disco bar selected, a ready status, and Darren's labelled cylindrical reference inside the embedded viewer. This was a real browser observation. No private model asset is served by the desk or committed.

Native automation attempts to click while the operator changed the browser were rejected by the computer-use guard. Those attempts are not counted as successful test actions. Keyboard activation and narrow-screen appearance have not been separately exercised.

The initial desk process was stopped and its session returned exit code 0 before the updated alias server was started. The current desk remains running for the operator. The OCP Viewer process was preserved throughout. No Sheets, CDP, audio, USB, or printer processes were started or changed.

The operator subsequently confirmed the proposed shared low-roof alignment. Its confirmation metadata and docs are included without changing geometry. Separate disco notes assess a rubber liner and magnetic retention; no magnet, target, liner, force, or fitted dimensions are selected.


## Shared desk scene (2026-11-01)

The live desk displays Arcade button, Disco ball, and All controls. Native Vivaldi inspection confirmed the All controls selection reached Ready to inspect and showed the blue reference button seated in its inclined box beside the current disco assembly and translucent open sphere. Both base bottoms are on Z=0; only horizontal layout changed. The original bar's pinned STEP supplies the sphere height and maximum fitted slice diameter. The illustrative sphere has equal sections at the original bar root and far end and a dome above the latter. It has no planar bottom cap or manufactured wall thickness.

`check_all_controls.py` checks the actual composed shapes, their placement, native spherical surface, equal section radii, open root, dome, and the unchanged button pose. Approximate desk heights are 4.45 inches to the button top and 9.10 inches to the illustrative ball top. These checks do not measure the real ball, establish upstream button validity, or approve fabrication. TypeScript and the real temporary-server route, origin/body, configuration failure, and publisher-shutdown checks passed with all three page identifiers.


The subsequent minimum-height disco study lowers its roof to 64 mm above the desk using the drawing's 59 mm flange-to-rear-shaft depth, 3 mm general bottom plate, and 2 mm clearance. The illustrative ball top is then 8.47 inches. The native checker verifies preservation of the upper interface, translated lower features and cover, full-depth clearance, and the reserved tool space. The visible spinner is dimension-based: body/housing envelopes, approximate red knob, and a rear-shaft axis with no invented diameter. Native Vivaldi inspection confirmed these references are visible through the lowered box in All controls. They are never print targets.
