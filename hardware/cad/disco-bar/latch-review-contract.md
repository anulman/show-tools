# Compare three detachable-bar latches

This review covers C1, C2 and C3 as proposed mechanisms. The existing A and B remain historical reference designs. Each new mechanism attaches the full-height bar to a knob-side plate whose padded set screws stay adjusted during attachment and removal.

## Evidence required for each prototype

| Check | Required evidence |
| --- | --- |
| Original fit | Retain the full 109.22 mm bar reach, measured insertion profile and far attachment end. Check the assembled socket entry, void and stop against the private source. |
| Independent grip | Compare every preset baseplate component across latch states in both Boolean directions. Latch motion must not move the screws, shoes or pads. |
| Torque and retention | Identify positive keys for clockwise and counterclockwise torque, and separate positive geometry resisting axial separation. A friction-only latch is insufficient. |
| Operation | Represent released, seated and locked states. Check intermediate motion, insertion and removal paths, control reach and the operator's reaction surface. State any sampled-motion limits. |
| Deliberate release | Attempted opening with the lock engaged must hit actual blocking geometry. Ordinary bidirectional rotation must not execute the release sequence. |
| Fixed box interface | Check moving controls against the roof, underside nut envelope, buffer, bottom and proposed wiring/ballast spaces. State whether access is continuous or requires a service angle. |
| Export integrity | Each proposed print part is a valid positive solid. STEP round trips preserve material. STL meshes are watertight, consistently wound and have positive, matching volume. |
| Repeatability | Record source and asset hashes, parameters, units, parts, states, rejected mutations and validation limits in a fresh receipt. |

A valid STL does not establish grip, fatigue life, support loads or printer fit. Printer, material, orientation and actual hardware remain unselected. Report unresolved checks as unresolved; do not infer mechanical approval from mesh integrity.

## Buffer and support comparison

Knob pads resist sliding. A support surface between the rotating bar and stationary box must allow sliding. Keep these functions separate in the models and parts list.

Use padding cut from off-the-shelf stock on rigid backing shoes. Record pad thickness, compression envelope, replacement access and adhesive location as proposals. Do not require custom moulded or printed compliant pads. The set screw loads the rigid shoe, which spreads load into the padding. Neither adhesive strength nor the stock padding's compression behaviour follows from a CAD clearance check.

A replaceable polymer thrust washer is a candidate buffer. [Igus describes dry-running polymer thrust washers](https://www.igus.com/plastic-bearings/thrust-washer?contentview=1). [Curbell describes friction and wear plastics](https://www.curbellplastics.com/materials/operating-environments/plastics-for-friction-and-wear-applications/) and explains that wear depends on operating conditions. These references identify candidate approaches; they do not establish performance against our printed surfaces.

No bearing material or thickness is selected. Each prototype records its proposed buffer envelope and how it is retained and replaced. The model must distinguish support through the box from loads still carried by the knob and encoder. Physical tests must check drag, runout, wear, slip, lift-off and repeated release.

## Findings before publication

Compare operator steps, proposed print and purchased part counts, assembly access, loose parts, accidental-release paths, support routing and failed checks. Recommend which ideas to combine only after all three receipts are available. Do not publish new latch or box geometries to the shared viewer during this stage.
