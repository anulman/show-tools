# C — score roster and voice library

## Problem

The performance screen needs a modest account of the rest of the arrangement while voices, characters, effects and sheet bindings need a durable editing home. Putting every setting directly below each performance item makes the desk grow unpredictably. This candidate keeps performance small and puts catalog work into a roomy library.

## Usage (caller’s view)

1. Below the four large pads, two 64px instrument strips show Bass and Drums with their source row and the current written cue. Their status says “Chart cue” or “No cue”; the UI does not claim to hear them.
2. Click a strip or **Manage voices**. The library opens with a spreadsheet-like roster of all eight source rows. AF voices and other instruments are visibly distinguished.
3. Select a voice, choose an approved Video character or leave it unassigned, add/reorder/remove effects and write notes. The source cell stays beside the row name. **Save voice** acknowledges preview-only storage.
4. Export the preview as a JSON file. This works; it is labeled a design preview rather than a production library backup.

The left roster is replaced by a native voice selector on mobile, preserving room for character and effect editing. No audio or microphone is started by any control. Transport controls and pad faces are display fixtures, explicitly marked by the top study banner.

```ts
const voices = await catalog.forSheet(sheetIdentity);
renderScoreRoster(voices, nativeObservations, writtenCells);
const draft = catalog.editVoice(voiceId);
await catalog.saveVoice({ ...draft, expectedRevision });
await native.prepareVoiceEffects(catalog.forNativeParts(compiled.parts));
```

The last call is made only while stopped. It resolves explicit part-to-voice bindings. Extra catalog voices are never forced into six profile slots.

## Shape

```ts
type Voice = {
  id: VoiceId;
  name: string;
  characterId: CharacterId | null;
  notes: string;
  revision: number;
};
type VoiceEffect = { voiceId: VoiceId; ordinal: number; definition: EffectDefinition };
type SheetVoiceBinding = {
  spreadsheetId: string;
  sheetId: number;
  labelCell: string;
  voiceId: VoiceId;
  sourceLabel: string;
  sourceDigest: string;
  nativePartId: string | null;
};
type Character = {
  id: CharacterId;
  avatarAsset: AssetReference;
  figmaArtwork: FigmaReference | null;
};
```

A catalog transaction owns the voice, its ordered effects and explicit sheet bindings. AF-prefix discovery creates managed row candidates. Existing known native parts can be matched by their declared source reference. Other rows can carry metadata without being declared audio inputs. No global name matching, auto character assignment, cue inference or new native voice creation occurs.

Native audio remains the sole owner of applied graphs, recording/playback and timing. The catalog is the owner of saved authoring data. An editor draft, saved local value and native applied graph are separate states, even though this small prototype shows only the first two as preview state.

Presentation should use approved Video model IDs for identity. Figma references link artwork provenance; design tokens can govern avatar frames, colors and selection rings, but a color token is not a character identity. Default assignment is `null`. The prototype uses cleared existing Gator/Tapir assets, and starts every voice unassigned.

The public interface is one voice transaction, one sheet query and backup/restore. SQL indexes and serialization remain behind that interface; callers do not coordinate child-effect CRUD themselves. This keeps the module deep enough to prevent half-saved stacks.

## Storage options

The preferred production shape is a local browser catalog with relational voice/effect/binding tables, one transaction for a complete voice edit and an explicit portable backup. SQLite can implement that model without an always-running native helper. A browser storage adapter must report whether a save is durable before showing “Saved”. A smaller IndexedDB implementation can preserve the same domain semantics if SQLite adds unacceptable browser constraints. Either choice must verify concurrent editor tabs, revision conflicts, reload persistence, migration and import rejection; this prototype implements none of those persistence claims.

Import must decode and validate a complete backup before replacing the catalog. An unresolved character ID, missing source row, or duplicate binding must be shown as unresolved rather than silently reassigned. A changed row label requires reconciliation. Export/import must retain stable IDs, effect order, source identities and character asset references.

## Strengths to graft

- The tiny score strips preserve the physical-pad hierarchy and make non-AF instruments visible without inventing native activity.
- The library roster gives every source row a stable, inspectable home. The source cell is always visible alongside its voice name.
- The full editor has room for ordered FX and character selection. A native mobile selector is simpler than squeezing a desktop table.
- The explicit empty-stack state says “Dry” instead of implying a missing value.
- The character picker starts unassigned, uses existing artwork and offers its Figma provenance link.

## Tradeoffs accepted

- Opening a modal costs a click in exchange for a stable performance screen.
- The initial strip carries less sound-design information than inline editors; the library is the editing home.
- Two compact strips can become a roster as instruments grow. A score strip is not an audio meter and should not resemble one.
- The fixture paints a Bass chart cue to demonstrate a nonempty case. It is explicitly a sample, not the actual bar-45 chart value.

## Alternatives considered

Inline channel-strip editors would make adjustment discoverable, but each expanded stack changes the performance layout and can overwhelm the new section. A separate full editor page would make ownership clear, but loses immediate song context and needs another navigation flow. A persistent side drawer is attractive on wide screens; the modal gives this candidate a stronger “library” mode without permanently reducing the desk width.

## Red-flag screen

The roster and editor read one catalog, with no independent copying of effect defaults. Musical state stays native. Saved metadata never claims an audible instrument. Stable identities remain independent of display labels. The unbuilt storage adapter is the main boundary risk; the final version must not display durable-save success before persistence completes.

## Synthesis decision

Pending the parent comparison. This candidate is a source-oriented library and compact score roster, not a recommendation to ship it unchanged. The strongest grafts are its source mapping roster, native mobile selector, explicit dry state and small chart-cue strips.

## Next implementation step

Prove a complete voice/effect/binding save and reload through the selected local catalog adapter, then connect the editor to the existing stopped native graph preparation.

## Verification performed

TypeScript behavior bundled successfully with the repository’s existing esbuild. HTML and CSS are standalone prototype files. No browser screenshot or physical playback verification is claimed by this candidate; the parent owns live visual comparison.
