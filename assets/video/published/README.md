# Canonical Figma exports

Figma owns promoted character art and animation. This directory holds derived offline runtime exports and compact, hash-bound certificates. It does not archive the studies or their raw review reports.

This first milestone contains two Knob Goblin families: `C06/default` and `C06/special/03`. Their nine poses, twelve separate Body/Effects layers and 130 held timeline samples were re-exported from [the canonical Figma file](https://www.figma.com/design/QWreOYAnaje2LlywefJFiK) and matched exactly. The packages verify without the original artwork or reports. Existing recorded visual verdicts carry forward only because their pixels matched; an export does not award a new visual approval.

Certificates retain semantic artwork/motion identities, Figma set/pose/layer/timeline references, native dimensions, source offsets, pivots, registration transforms, quarter-note HOLD keys, action and cycle lengths, exact file/pixel hashes and compact verdicts. The calm pilot recovers a 64×80 native canvas from its 640×800 Figma registration, including the six-pixel vertical offset. The special uses 128×128 poses with Effects behind Body. Do not add `sourceOffset` again to the exported complete drawing.

## Recover and verify

From the repository root:

```sh
npm run test:figma-exports
node --import tsx scripts/video-expansion/design-system/promotion.mts reexport-scripts assets/video/published/C06-special-03 /tmp/c06-reexport
```

Load the Figma use/motion skills, create a Figma MCP session for the returned file key, and execute the generated reads. These pilot reads select Characters page `31:51` and Motion review page `54:1383`. Save each returned `pose`, `body` and `effects` SVG as `pose-N.svg`, `body-N.svg` and `effects-N.svg`; save the timeline result as `motion.json`. Then run:

```sh
node --import tsx scripts/video-expansion/design-system/promotion.mts check assets/video/published/C06-special-03 /tmp/c06-reexport
```

Use actual component `SVG_STRING` geometry. A canvas-background preview PNG can destroy transparency. Recovery follows the declared native registration without filtering and checks every source raster pixel against its native cell and transparent margins; centre-only sampling could hide stray geometry or blurred edges. Transparent RGB is normalized to zero. Blank Effects frames remain explicitly empty. Pixel or composition changes, missing poses, fractional opacity, incorrect HOLD timing and extra blinks return failure. Verification inspects all authored changes as well as the fixed sample grid. Re-exporting changed art requires a new review, never an automatic new certificate.

## Plan routine expiry

```sh
node --import tsx scripts/video-expansion/design-system/retention.mts /tmp/artifacts.json assets/video/published/retention-dependencies.json
```

Supply an explicit artifact list. Each entry has `path`, `kind` (`prototype`, `process-evidence`, `runtime`, `code` or `regression-fixture`), `state` (`active`, `awaiting-promotion`, `abandoned` or `completed`), `owners` (motion IDs), `lessonsPath`, `requiredBy` and `referencesReviewed`. Record lessons and review actual references before marking an inactive artifact eligible. Intentionally abandoned prototypes do not need to become canonical art. The command plans only and always reports `deleted: 0`; it has no delete command or schedule.

The dependency inventory protects whole trees, including path aliases and containing folders. It records a current blocker: the local candidate-import builder still needs original C06 artwork/manifests, and 28 other motion families still need their existing reports and source inputs. Those inputs remain protected until their dependencies migrate. This main-based milestone does not include that builder, its 30-family authoring catalog, registry overlay, initial candidate promotion, or raw studies. An independently portable runtime package does not clear those separate expiry blockers. Maintain the inventory when integrating later authoring milestones; the tool cannot infer undisclosed consumers.

## Lessons retained

- Draw character-specific joints and support transfers. Whole-body lifting/scaling reads as jumping; stable pixel clusters prevent texture shimmer.
- Silhouette connectivity cannot prove intact knees, ankles or shoes. Trace limb endpoints at motion extremes and keep minimal regression fixtures when they support a maintained check.
- Keep body and deliberate effects separate. Verify composed pixels as well as each layer.
- Preserve nonuniform HOLD keys and neutral rest. Action duration and review-cycle length are distinct.
- Re-export transparent geometry and verify native registration before expiring inputs. A blank Effects frame is explicit emptiness, not permission to swallow export failures.

The [character-dance skill](../../../skills/character-dance/SKILL.md) carries the exploration, repaint, anatomy, export and retention workflow. Live Performance Engine integration and further design-language expansion are separate work.
