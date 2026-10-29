# Cross-judgment: voice editor studies A, B and C

This judgment compares all three complete HTML files and design notes, plus C's linked CSS. Scores are based on source inspection, not live browser verification. The parent owns desktop/mobile screenshots and interaction checks. None of these prototypes proves durable persistence or native audio application.

## Scores (0–5)

| Criterion | A: inline roster | B: cast strip + side editor | C: score roster + library |
|---|---:|---:|---:|
| Performance hierarchy: pads dominant, smaller section below | 5 | 4 | 5 |
| Editor clarity: ordered effects, character and sheet connection | 4 | 5 | 5 |
| Source/native activity truth | 5 | 5 | 5 |
| Mobile accessibility | 4 | 3 | 5 |
| Maintainability and durable-library design | 4 | 4 | 5 |
| Total (not a selection rule) | 22 | 21 | 25 |

A's quiet 64px rows best preserve the desk's rhythm, and its 44px editing controls are easy to target. Its expanded inline inspectors move the performance surface and can produce an unwieldy long page. B makes character identity most approachable and puts the entire edit in one shared inspector; however, its 91px cards compete more with the pads, its two-column strip stays dense on mobile, and many actions are only 25–31px high. C combines compact 64px strips with the clearest source-oriented library, a desktop roster and a useful native mobile selector. Its full modal is a heavier interruption than B's side editor. C scores highest on structural clarity, but shipping C unchanged would lose worthwhile interaction and visual ideas from both other studies.

## Proposed final synthesis

Use **B's single shared editor interaction as the shell**, **C's source-oriented catalog as its interior**, and **A's restrained roster density and explicit save/application language**. This is a composed fourth design, not a renamed winning prototype.

1. Keep the existing practice desk and its large performance pads. Add a calm ensemble section below them. Use A's compact row proportions and C's written-cue/source information. A small avatar from B adds character without making an instrument look like another playable pad. Prefer two 64px strips on wide screens and full-width rows on narrow screens. Long names and cues must wrap or truncate deliberately without hiding the state label.
2. Open one shared editor from a pad's FX control, an ensemble row, or Manage voices, as B does. Preserve the desk's positions while editing. Use a right-side dialog on desktop that can expand for catalog work; use a full-width mobile sheet with its own scroll area. Do not embed A's expanding effect stacks in the resting performance page.
3. Graft C's searchable roster, visible source addresses and AF/reference distinction into catalog mode. Replace the roster with C's native voice selector on mobile. A single-voice entry should open directly at that voice without requiring another catalog selection.
4. Graft B's character preview and independent avatar-frame appearance into the inspector. Keep C's explicit Unassigned option and artwork provenance link. Character identity, artwork variant and Figma styling are separate values: canonical character IDs are **A07 / A29**; `gator-original` and similar IDs identify artwork, not characters. Figma node links record provenance; deliberate tokens can define frame color and selection rings. Every final voice starts unassigned until the operator chooses.
5. Use C's source connection near the editor heading, A's qualified binding summary, and B's explicit binding-conflict message. Display spreadsheet, worksheet and source row identity together. AF membership is discovered from the source prefix and displayed as read-only; non-AF rows can receive the same metadata. Never merge voices by display name or silently reuse a neighboring row after a sheet edit.
6. Use the ordered FX editor from B/C, A's generous up/down/remove targets, and C's explicit **Dry** state. Keep a visible order number and enough room for parameters. Bring every action, close control and style choice to a practical 44px target. Retain B's sticky save footer and keyboard dismissal/focus restoration, while verifying background inertness and focus containment in the actual implementation.
7. Graft A's distinction between **Saved locally** and **Applied to audio** into the final status area. An unsaved draft, a durable library revision and the prepared native graph are different states. Source cue labels remain **Chart cue / No cue**; only native observations can justify recording, looping or audible-activity claims. Do not turn nonempty sheet cells into a “Playing” light.

## Durable ownership

Use the agreed SQLite worker for voice, ordered-effect and qualified-binding transactions, with a local durable snapshot/export path for recovery and portability. This is a production requirement, not a capability demonstrated by the studies. Keep SQL, migration, revision checks and serialization behind a single catalog interface. Save one complete voice edit atomically, acknowledge success only after durable persistence, and surface concurrent revision conflicts. Validate an entire import before mutation; preserve IDs, order, source identities and artwork references. The UI must never coordinate separate child-effect saves itself.

The catalog owns authoring metadata. Native C++ continues to own musical timing, graph application, capture and playback. Resolve explicit native part mappings; extra AF rows may exist in the catalog without being squeezed into six existing profiles. An unmapped voice must remain visibly unmapped. Preparing changed graphs while stopped must use the existing engine boundary; metadata must not invent an audio input or mutate retained recorded sound.

## Retain / reject / verify

| Study | Concrete material retained | Material not carried forward |
|---|---|---|
| A | Low roster density; binding footer; large effect actions; saved-versus-applied distinction | Expanding inline editor that shifts the desk |
| B | Shared entry points; side-editor interaction; avatar/appearance preview; sticky footer and focus behavior | Tall cast cards; undersized actions; selector values conflating character and artwork |
| C | Source roster; compact cue strips; native mobile selector; Dry and Unassigned states; transactional catalog boundary | Full library interruption for every quick edit; model IDs used as canonical character identity |

Before implementation is called complete, verify the assembled design at 1440px and 390px, with long voice names and several effect stages. Exercise keyboard opening/closing and focus return, native mobile selection, row conflicts, unassigned/missing character handling, save/reload, export/import, schema migration and concurrent-tab revision conflicts. Verify a saved preset reaches the intended stopped native profile and leaves unrelated profiles intact. Prototype sample cues, character associations and preview-only state must never become production defaults.
