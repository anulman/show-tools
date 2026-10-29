# CAD workstream integration verification

The initial integration uses the existing pinned CAD environment and running localhost viewer. Neither worker starts or contacts the viewer. The coordinator's `workspace.py` is the publisher for both workstreams.

The coordinator independently ran `cad box-check` through the Python entry point with output under `/private/tmp/box-coordinator-check`. Four parts passed solid validity, STEP and STL round trips, and assembly constraints. The box workstream's receipt retains `print_readiness: NOT_READY` and its unmet physical and printer gates. An offline rendering of exported interior views was inspected for the wire passage, screw pockets, ballast compartment, and removable bottoms.

The coordinator independently imported Darren's original STEP through `disco_bar.py`. It remained one valid positive-volume solid, in millimetres. The worker's full mesh-comparison receipt and offline render were inspected. Neither private attachments nor their derived geometry are included in Git. Mesh scale comparisons are sampled evidence, not full equivalence proofs.

`cad view disco-bar --step PATH` published the private reference to the existing server. Native Vivaldi interaction selected its existing OCP Viewer tab, and the reference label and cylindrical geometry were visible. A missing private path produced a clear CLI error with exit code 2 and did not change the preview.

`cad view box-mount --explode 25` publishes the two square mounts, with bottoms lowered 25 mm for inspection. The ignored current-view receipt records the selected workspace, source hashes, labels, and camera choice. Switching workstreams resets the view; subsequent publishes keep the camera unless requested otherwise. Vivaldi displayed both labelled shells, both lowered bottoms, and the separate red and blue button references. The wire passages, fastener pockets, and ballast compartments were visible through the translucent shells. Publication and visible delivery do not establish physical fit or print approval.

No USB IO, printer jobs, Sheets, Chrome CDP, or audio processes were started or changed. No adhesive, friction, strength, stability, or measured hardware fit has been tested.

`bash -n hardware/cad/cad`, local guide-link checks, and `git diff --check` passed.

Independent main-session review rejected the initial bottom placement because it consumed 3 mm of the operator's minimum interior reserve. The correction keeps the interior floor at Z=-35.25 mm and extends the 3 mm bottom outward to Z=-38.25 mm. The coordinator reran corrected exports and the actual-CAD reserve regression check; both passed. The check measures A/C cover and shell bounds with 3 mm and 5 mm bottoms. The corrected boxes were republished with bottoms lowered 25 mm, retaining the current camera.

## Inclined arcade clearance and level component variants

The operator superseded the original 35.25 mm arcade reserve with at least 3.25 inches, exactly 82.55 mm, from the counterbore floor along the tilted button's centre axis. The low edge need not supply that full length. The active preview now separates `arcade-inclined`, `rotor-level`, and `mushroom-level`. The former flat Adafruit study is historical.

The coordinator independently exported all six parts and three assemblies and ran `check_requirements.py` and `check_reserve.py`. All passed. Default arcade interior depth is 84 mm, with its removable bottom extending outward to 87 mm. The 82.55 mm corridor with proposed 13.5 mm radius is empty of housing and ballast geometry, including its off-axis end. The floor gap is approximately 0.5875 mm. This is a proposed empty corridor, not proof that the installed switch and harness fit.

The level rotor has a proposed 34 mm across-flats, 5 mm deep hex recess, and a proposed 29 mm body passage based on the manufacturer's nominal 28 mm body. The hex dimensions are explicitly unverified by the drawing. The mushroom housing remains uncut. Both level exterior heights approximately match the inclined housing's highest edge. Actual components, tolerances, print settings, and physical fit remain unverified.

The publisher adds `--variant` selection, rejects box-only variants on the disco workspace without publishing, and resets framing when changing variants. `cad view box-mount --variant all --explode 25 --reset-camera` published the new comparison to the existing server. The disco notes now distinguish a mechanically retained replaceable liner, glue attaching a liner to the socket, direct knob bonding, and a formed glue sleeve. No liner material or thickness is selected.

The new three-variant publish returned successfully. Native inspection found Vivaldi focused on an unfinished address entry in another tab, so that input was left untouched. The latest three-variant browser delivery awaits opening the existing OCP tab; exported inspection views were visually checked offline.

## Corrected 2.5-inch reserve and confirmed low-roof alignment

The operator corrected the minimum from 3.25 inches to 2.5 inches, or 63.5 mm. The confirmed datum and direction remain the counterbore floor along the tilted button centre axis. The coordinator independently reran all six part exports, all three assembly checks, the finite-corridor requirements check, and cover-thickness reserve checks. All passed. Default interior depth is now 65 mm, with the 3 mm cover extending outward to 68 mm below the seat. The proposed 27 mm diameter corridor has approximately 0.5650 mm floor clearance at its lowest off-axis endpoint.

The operator then said the boxes should "share the lowest edge" so the incline lifts the arcade buttons. The level roofs align with the arcade roof's low edge and share all bottom planes. The operator confirmed this alignment, and the requirements flag records it as confirmed. The generator separately checks the actual uppermost roof vertices at the low boundary and the common bottom datum. Level exterior height is approximately 80.0551 mm; the arcade high edge reaches approximately 91.0786 mm.

The corrected comparison was published to the existing viewer with its camera retained. Exported top and interior views were inspected offline. The rotor hex remains illustrative, the mushroom roof remains uncut, and physical fit, ballast performance, and print readiness remain unverified.

## Three screw-clamp disco concepts

This milestone was superseded by the full-bar restoration below. Its isolated-part checks did not preserve the functional full-height bar or establish insertion fit through the ball opening.

The operator replaced the magnet proposal with two screws and replaceable rubber or foam pads. The active Disco bar preview compares A, a transverse padded bridge; B, independent guided jaws; and C, an axial drawplate on the original alcohol-channel axes. C uses separate taper shoes to turn plate lift into radial closure. The source channels are open scallops, so C adds enclosed screw bosses rather than treating the thin original walls as threaded structure.

The coordinator independently ran `hardware/cad/cad disco-check --concepts hardware/cad/build/disco-clamps`. All nine proposed print parts passed positive-solid validation, STEP round trips, and watertight, consistently wound STL checks with matching volumes. The assembly checks passed for pad seats, print and pad intersections, nominal knob clearance, and hardware-envelope clearance through the prints. Discrete samples checked A and B closing and opening, and C's complete drawplate and shoes moving against the fixed carrier. Pad-to-knob overlap during closing is reported as a proposed compression envelope. These checks do not model deformation or prove a continuous collision-free stroke.

The final offline comparison render was visually inspected. The existing desk checkout was fast-forwarded to the verified model commit, so subsequent tab selections use the new source without restarting either service. `cad view disco-bar --step PATH --reset-camera` successfully published 33 labelled objects. The receipt identifies model source SHA-256 `91b54daa85f3610df6ba2899477bc2a29ad2abafaeeebaf70d155b92ad864a13` and the original private STEP hash. Native browser confirmation remains pending because automatic approval review rejected reading an unrelated private foreground page, and scoped browser-tab control is unavailable. Publication alone is not visible-delivery evidence.

The illustrative knob diameter is 40 mm. Pad material, hardware standards, actual fit, carrier-to-shell attachment, independent ball support, print settings, and mechanical performance remain unverified. The reference crops are displayed below each concept as separate context. C's carrier has a labelled display-only cutaway; its exported part is complete. No private reference geometry, pads, or hardware envelopes are included in the print-part exports.

## Restore the complete measured bar

The operator clarified that the original bar's full height reaches the top attachment and its outer width was precisely measured for the disco-ball opening. Replacing it with short carriers and a cropped reference discarded those functional constraints. B's hardware and C's bosses also extend beyond the original outer profile. The clamp studies remain historical headless exports, and the earlier replacement recommendation is withdrawn.

The default preview now returns the complete, unmodified original STEP as one solid in its original pose. The coordinator independently checked its source SHA-256 `f0a21384179b69eff79205032dad536bfa1350e358c25ed0fe01de4189f2e003`, X/Y bounds ±47.2306651 mm, Z bounds -109.22 to 0 mm within CAD tolerance, and volume 75,384.7501653 mm³. The inspector checks the actual preview scene as well as the input asset. `disco-bar/check_full_bar.py --step PATH` verifies the restored scene and rejects the historical 28 mm crop, 35 mm display offset, and a replacement assembly scene. These regression checks protect this restoration, not arbitrary future geometry changes with matching bounds and volume.

The running desk checkout was updated without restarting either service. A reset-camera publication succeeded with the single full-bar label. Native visible-delivery confirmation is still pending; no unrelated private foreground page was read. Future revisions must preserve the complete insertion profile, cross-sections, top attachment, and continuous torque path, then check the assembled insertion and tool-access envelopes before presenting fitted clamp alternatives.
