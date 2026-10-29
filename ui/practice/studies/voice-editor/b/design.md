# B — Cast strip with a side editor

## Problem

The desk needs an ensemble view and a voice library without competing with the large performance pads. The same voice can have an ordered effect stack, a Video character, and qualified sheet-row connections. Source arrangement information must remain distinct from native audio activity. The current engine still exposes six prepared profiles; attaching metadata to Bass or Drums does not create another audio voice.

## Usage (caller’s view)

Open `prototype.html` through the shared prototype server. The page is a labeled design study with sample transport/native states and illustrative character previews. Bass and Drums appear as small cards below the pads. Their labels describe written cues, not detected sound.

1. Click either ensemble card to open a side editor. Character, effect order, and source connection are visible together.
2. Choose **Unassigned**, Gator, or Tapir. Change the avatar frame color independently of the character. Add Slapback/Chorus, edit parameters, move stages up/down, and remove stages. An empty stack is explicitly **Dry**.
3. **Save preview** updates the card in this page. Reload resets everything. The download icon exports a JSON object marked `prototypeOnly: true`. No persistence, SQLite, microphone, or native preparation is claimed.
4. **Manage voices** opens the same editor for all six AF voices and the two reference instruments. Pad FX links enter the same editor at their voice, avoiding separate metadata editors.

The transport buttons only explain that this is a layout study. Escape, the backdrop, and the close button dismiss the editor. The modal traps keyboard focus and restores the prior control.

## Shape

The final catalog should own voice identity independently of source labels, with one transaction saving a voice and its ordered effects. Existing `LiveEffectDefinition` should remain the authoritative effect shape.

```ts
interface VoiceEdit {
  voiceId: VoiceId;
  displayName: string;
  characterId: CharacterId | null;
  avatarAssetId: AvatarAssetId | null;
  avatarStyleToken: AvatarStyleToken;
  effects: readonly LiveEffectDefinition[];
  notes: string;
  bindings: readonly SheetVoiceBinding[];
}
interface SheetVoiceBinding {
  spreadsheetId: SpreadsheetId;
  sheetId: SheetId;
  row: number;
  sourceLabel: string;
}
type Activity =
  | { kind: 'native'; state: NativeVoiceActivity }
  | { kind: 'chart-cue'; bar: number; text: string; sourceCell: string }
  | { kind: 'no-cue' };
interface VoiceCatalog {
  save(edit: VoiceEdit, expectedRevision: number): Promise<SavedVoice>;
  export(): Promise<PortableVoiceCatalog>;
  import(input: unknown): Promise<ImportPreview>;
}
```

These are design signatures, not a production API added by the prototype. IDs and tokens need schema validation at storage/import boundaries. A catalog adapter can hide SQLite or another durable browser-local store, migrations, transaction ordering, and revision conflicts. Rendering needs one catalog view and a separate native observation; it must not reconstruct musical activity from a receipt timestamp.

Video confirms canonical character IDs `A07` (Gator) and `A29` (Tapir). Character identity, avatar artwork/appearance, and the visual frame are separate properties. The prototype selector combines character and appearance for a fast visual study; final storage must keep those IDs separate. Existing cleared `assets/video/manifest.json` model IDs identify the preview artwork, not canonical Video characters. Figma provenance already lives in `assets/video/figma.json`; an artwork node reference is not itself a style token. Color-token synchronization can be added deliberately without treating the character drawing as a color style. Final associations start unassigned until the operator chooses them.

Bindings are qualified by spreadsheet, worksheet, and source row. They are not merged by voice name. AF membership is source-owned; it is shown as a read-only badge. Non-AF musical rows can have metadata. A changed label/row needs explicit reconciliation rather than silently applying a formerly neighboring row’s preset. The prototype rejects a row already bound to another voice.

## Synthesis contribution

This candidate offers three pieces worth grafting into the final version:

- The low ensemble strip: avatar + voice + one truthful activity label + source location, with smaller dimensions than the pads.
- One shared inspector reached from ensemble cards, pad FX links, or Manage voices. The performance layout does not grow when editing.
- A compact character preview with separate avatar frame tokens, followed immediately by the ordered effect stack and sheet provenance.

It should borrow a denser roster or table from another prototype for bulk mapping, searching, or comparing many voices. A side editor alone is slow for large libraries.

## Tradeoffs accepted

- Accept an extra click to edit in exchange for a quiet performance surface.
- Accept that a side panel temporarily covers part of the desk in exchange for preserving pad and ensemble positions.
- Accept static avatars here in exchange for making character identity readable without introducing decorative musical motion or scheduling.
- Accept one voice at a time in exchange for a clear save boundary; bulk library work should use another candidate’s stronger view.

## Alternatives considered

Inline editors hide less of the page, but expanding several voices can move the controls during performance. A full-screen catalog is better for bulk data, but interrupts the immediate connection between a sounding voice and its metadata. Making every ensemble item look like a pad was rejected because it would imply new playable controls and weaken the hierarchy.

## Open questions and risks

The final active-state source for non-AF instruments needs explicit semantics. This candidate shows the written cell text and never calls it audible. Actual SQLite persistence and import conflict handling belong to the final storage implementation. Physical playback, Video delivery, and automatic character binding are not demonstrated here.

## Verification

The standalone TypeScript passes strict checking. esbuild produces the runnable `prototype.js`. No repository files or dependencies changed. No manual browser screenshots or interaction verification are claimed by this candidate; the parent owns the combined visual review at 1440 and 390 pixels. No device or process was started.
