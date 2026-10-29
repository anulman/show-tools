# C1 private prototype findings

C1 separates the preset knob clamp from the bar latch. The shared v2 baseplate uses simple proposed 2 × 16 × 8 mm cut-stock pad envelopes, adhesive-backed toward retained printed rigid shoes. Adhesive never contacts the knob. The full bar seats over straight pilot keys. A separate quarter-turn retainer captures the baseplate flange; an independently retained safety key blocks reverse collar movement.

This is the first prototype checkpoint, not final C or manufacturing approval. C2 and C3 have not yet been compared.

## Checked in actual CAD

- Nineteen valid single-solid components in each of seven states: locked, key pushed, key turned, key removed, turning, released, and detached.
- STEP round trips and watertight, consistently wound STL meshes for all posed components. Hardware and pad exports are reference envelopes, not print instructions.
- No detected rigid intersections in those states; all components stay within the original radial envelope.
- The original full bar reach and far attachment end remain intact. The baseplate supplies the known source socket, entry bevel, and fixed blind stop.
- Every preset baseplate piece remains identical by two-way Boolean comparison through the complete bar attachment sequence.
- Bar pull-off encounters the retainer/flange contact. Reverse collar movement encounters the safety key. Removing the lugs or key defeats its respective rejection test.
- Straight key extraction and unpushed key rotation encounter the key housing. Pilot keys reject relative bar torque in both directions.
- The contact artifact contains two actual planar bar patches in the proposed R43–45.5 mm support band. It does not assume a complete source annulus or prove washer support strength.

## Unresolved findings

The collar tool sweep is a clearance envelope only. Positive tool engagement and actual operator ergonomics are not verified. The operator must hold the keyed bar while turning the separate collar; spinning the entire ball does not establish relative collar motion on a free spinner.

Underside service uses an explicit alignment angle and quarter-arc tool windows. There are no permanent stems through the fixed roof. The nominal gap is 9 mm; 6 mm is a comparison, not a verified fit. Exact roof, stock-hex keeper, buffer, table access, and full-rotation checks belong to the coordinated box study. A minimum height above the roof alone cannot exclude a keeper collision.

The grip pads and the low-drag print-on-print support buffer have separate purposes. Pad bond strength, clamp force, wear, actual hardware standards, installed knob height, and support loads remain unverified. Pad replacement is checked with the clamp removed from the knob; ordinary bar removal does not disturb the preset.

The early bar STL had three non-manifold anchor seams. Giving the anchor/tab junction finite overlap removed those seams in the actual model. No mesh hole filling or repair is used.

## Reproduce

```sh
~/.local/share/show-tools/cad/venv/bin/python \
  hardware/cad/disco-bar/check_couplings.py \
  --step "$SHOW_TOOLS_DISCO_STEP" --concept C1 \
  --output hardware/cad/build/c123
```

`C1-receipt.json` and `interface.json` identify the reference and every geometry dependency. They contain per-state STEP/STL paths and hashes, control-sweep artifacts, and actual contact patches. These files and all derived geometry remain local and ignored. The checker removes stale receipts before starting, so failed runs cannot leave an old success receipt presented as current.
