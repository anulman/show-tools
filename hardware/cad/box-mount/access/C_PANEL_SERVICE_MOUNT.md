# C mounting box: remove the bottom for collar service

Historical ballast-bearing candidate: the operator superseded it with the [four-print ballast-free C base](C_MOUNT_NO_BALLAST.md). Its sources and exports remain preserved.

This is the current mounting-box candidate for final post-glue C `456665c`. It supersedes the marked, ported-bottom candidate. The dedicated lock hole and collar-drive arc are closed. No `3`/`4` access labels remain. The original wire exit and four cover-fastener features are preserved. Two small internal blind clearances accommodate the stationary ballast-retention screw heads; they leave at least 2.3 mm of bottom skin and create no external latch opening.

Before any installed collar or root-tool operation, remove the four ordinary M3 cover screws and lower the bottom. The wiring stays attached to the stationary shell, and the sealed ballast cassette stays positively retained. No cable disconnection, cutting, cable-slack assumption, or ballast removal is required. After both C keys are withdrawn, refit the bottom and its four screws before normal rotation. The ball/bar and its glue bond remain untouched.

The checked C operation remains the [post-glue C sequence](../../POST_GLUE_REVIEW.md#installation-and-removal), with bottom removal before root-tool entry and bottom refitting after tool withdrawal. The collar must be at its upper stop before turning; its 3 mm lock and 4 mm drive keys must bottom on their checked socket floors. Both tools share a verified whole-rotor orientation, so the supporting push transfers with the ball resting on PTFE. Stable 180 mm service support remains necessary. The open bottom does not grant clearance through the stationary roof, stock hex, ballast or hardware: those objects remain in the actual tool checks.

## Stationary wiring and ballast

The two existing closed cable-tie eyes retain their positions and passages. Short ribs join them to the fixed front wall instead of the removable bottom. Their complete tie-loop/head and nominal 3–8 mm sleeved-bundle checks are rerun against the fixed shell. The original cable envelope and exit remain clear.

The closed eight-cube cassette moves upward 1.5 mm inside its existing tray. Its body, lid, cubes, and two independent M3×10 closure joints retain their original geometry. Local head wells and roof bosses preserve a 2 mm roof web over its closure screws.

Two purchased steel M3 Type L penny washers retain the cassette from below, each held by an ordinary M3×16 button screw and a captive M3 nut in a stationary tray-wall post. There are no custom printed keeper pieces. The selected washer is nominal 3.2 mm ID × 12 mm OD × 0.8 mm thick. [TC Fixings' primary listing](https://www.tcfixings.co.uk/product/m3-type-l-penny-washers-bzp/718) specifies these dimensions. A 1 mm substitute is not admitted by this candidate.

The washer checks cover its full continuous radial play using a guaranteed steel annulus and a containing annulus. The [Böllhoff ISO 7380-1 sheet](https://eshop.boellhoff.de/out/media/pdf/ISO_7380-1_Edelstahl_A2_Innensechskant___de.pdf) supplies the M3 minimum shank diameter 2.86 mm, minimum underhead bearing diameter 4.97 mm, and minimum 16 mm screw length 15.65 mm. The maximum modeled washer float is therefore 0.17 mm. Finite contact witnesses remain inside the washer's guaranteed material and the cassette's guaranteed material throughout the tray's translation/yaw play. Head capture and full nut span plus one 0.5 mm pitch remain at the minimum screw dimensions. Actual washer tolerances, steel bending and resin strength still require physical validation.

Install the closed cassette and its washer retainers with the bottom absent, before fitting the knob module and ball. Its original closure stays independent: removing a retainer does not open the cassette. Normal collar service leaves both retainers engaged. Nut side loading, washer entry, screw entry/removal and full ordinary 2 mm hex-key paths are checked with the actual shell and cassette present.

## Parts and hardware

The default printed base remains seven pieces: shell, bottom, support spacer, two stock-hex keeper tabs, ballast body and ballast lid. The optional 2 mm shim is separate. Purchased PTFE and washer envelopes are not printed. Body/lid export placement changes with the installed cassette height; their physical part geometry does not change.

| Role | Hardware |
|---|---|
| Removable bottom | 4 × ISO 7380-1 M3×10 button screws; 4 M3 nuts |
| Independent cassette closure | 2 × ISO 7380-1 M3×10 button screws; 2 M3 nuts |
| Fixed-shell cassette retention | 2 × ISO 7380-1 M3×16 button screws; 2 M3 nuts; 2 Type L washers |
| Stock-hex keepers | 2 × ISO 7380-1 M3×12 button screws; 2 M3 nuts |
| Passive support/PTFE | 4 × ISO 10642 M3×12 countersunk screws; 4 M3 nuts |

Totals: six M3×10 button screws, two M3×12 button screws, two M3×16 button screws, four M3×12 countersunk screws, fourteen DIN 934 M3 nuts and two specified washers. Button-screw lengths are under-head; countersunk length includes its head. The original eight nominal 6.35 mm cubes, one cable tie per two-eye anchor pair, and purchased 1 mm PTFE remain separate material items.

## Verification

The recipe binds the exact compact-base receipt, final C geometry, ordinary-tool evidence `94057a1`, and admitted C protocol. It reconstructs the old port cuts on the pinned unported bottom to prove which openings were restored, and checks the old wiring and screw features against that source.

Actual STEP/STL exports establish:

- All 23 C solids in five stages at both heights clear the complete closed box at every angle through rotation-invariant containment, with zero angular samples.
- Whole ordinary C tool entry, full operation and withdrawal clear with the bottom absent. All thirty hardware envelopes are retained conservatively in these checks, including cover screws which normal service places outside. Additional retention hardware is included explicitly.
- The closed blank bottom blocks actual C tool entry. Tool service therefore requires bottom removal.
- Relaxed-race recovery, complete module withdrawal and full grip-tool motion remain clear with the new fixed features present.
- Four cover-screw removal paths, full ordinary 2 mm keys, and complete bottom removal/refit clear the retained roof nuts, wiring, capsule, washers and other fixed parts.
- The capsule has positive capture in all six directions without the bottom; its independent closure and the fixed strain relief remain functional.
- Stock-hex capture, lower support webs, actual C passive bearing patches, PTFE fasteners and the original source interfaces remain.

`checks.panel_service_lifecycle` enumerates the exact product of the unchanged 39-state C protocol and the box's independent open/closed panel state: 66 reachable states and 180 transitions. Every installed C action requires the panel open. Panel changes require both C keys withdrawn. Initial and final box states have the panel closed, and every reachable state returns to the bare glued bar with the box closed. Assembly/removal traces, reachable summaries and the graph digest are included. Four panel-guard mutations and five actual-C protocol mutations must fail. This graph treats each verified cover-screw/panel procedure as a macro; its individual continuous geometry is checked separately.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/c_panel_service_mount.py \
  --base-receipt "$COMPACT_V4_RECEIPT" --candidate-receipt "$FINAL_C_RECEIPT" \
  --bundle /private/tmp/post-glue-human-review-20261030-r1 --output /tmp/NEW-C-panel-service-box
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_c_panel_service_mount.py \
  --base-receipt "$COMPACT_V4_RECEIPT" --candidate-receipt "$FINAL_C_RECEIPT" \
  --bundle /private/tmp/post-glue-human-review-20261030-r1 --receipt /tmp/NEW-C-panel-service-box/verification/receipt.json
```

The fresh output contains `verification/receipt.json`, installed assembly STEP files, actual print-candidate STEP/STL pairs, an optional shim, and separate purchased washer envelopes. Material patterns remain bound to their existing files. Only printed parts belong in the print STL package. The inclined arcade box is unchanged.

This remains human-review geometry. Physical fit, resin shrinkage/brittleness, washer/retainer loads, pad grip, stable service handling, actual fastener fit and PTFE forming/drag/wear are unverified. The worker does not publish the shared viewer or start fabrication.
