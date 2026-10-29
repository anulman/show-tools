# A — Ensemble roster with an inline voice inspector

## Usage (caller's view)

The performance view adds two quiet rows below the large pads: Bass and Drums.
Each shows its sheet identity and the current chart cue, with no claim of audio
detection. Opening a row reveals its own settings in place. Choose an approved
character, edit the voice name, add ordered effects, move or remove a stage, and
save. **Manage voices** reveals the six AF-managed voices in the same row format.
**Export library** downloads inspectable preview JSON.

`prototype.html` is runnable at `/a/prototype.html` under the shared prototype
server. `app.ts` is the behavior source; `app.js` is its esbuild output. The page
labels all transport/activity as sample states. Editing changes memory in this
preview only; it never accesses a microphone or runs audio. Character bindings
start unassigned. The Cleared Gator/Tapir artwork is a selectable preview.

```ts
const library = await VoiceCatalog.open();
const draft = await library.editVoice(voiceId);
await library.saveVoice({ ...draft, characterId, effects });
const venue = await library.prepareVenue(song);
await audio.configureVoiceEffects(venue.routedProfiles);
```

The production caller saves a catalog transaction separately from stopped native
preparation. “Saved locally” and native “Applied” are separate visible states.
Retained takes preserve their actual recorded graph. Unrouted parts do not gain
an audio input merely by receiving metadata or an effect list.

## Problem

The same sheet contains playable AF parts and externally performed instruments.
The UI must expose their shared metadata without competing with the four large
performance pads or implying that a sheet mark proves a sound is playing.

## Shape

```ts
type Voice = {
  id: VoiceId;
  displayName: string;
  characterId: CharacterId | null;
  effects: readonly EffectDefinition[];
  revision: number;
};
type SheetBinding = {
  voiceId: VoiceId;
  spreadsheetId: string;
  sheetId: number;
  labelCell: string;
  sourceLabel: string;
  ownership: 'managed-af' | 'reference';
};
type VoiceActivity =
  | { kind: 'native'; state: NativeVoiceState }
  | { kind: 'chart-cue'; text: string; sourceCell: string }
  | { kind: 'no-cue' };
```

The catalog owns stable voice identity, character association, ordered effects,
and explicit sheet bindings. The source importer discovers AF labels, preserving
the source label and qualified cell. Non-AF rows can explicitly acquire metadata.
Name equality never merges two voices. Row movement or label changes require
binding reconciliation rather than silently attaching a different instrument.

SQLite tables can mirror `voices`, `voice_effects(voice_id, position, ...)`,
`sheet_bindings`, and a read-only approved character registry. A single catalog
writer handles transactions and expected revisions; the editor does not issue
SQL. Persistence belongs outside the audio worklet. Validate imports and asset
IDs at the catalog boundary, then present domain objects to the view.

Character content is a stable approved manifest/model ID, not a color token.
Figma references belong to asset provenance. Color/frame/size tokens can style
the avatar without becoming a second character registry. No Figma file is edited
by this prototype.

The catalog query returns explicit routed profiles and unresolved bindings.
There is no fallback to the current six profiles for a newly discovered voice.
Native PE remains the only musical state/processing owner. The roster renders
observed native activity where available and labeled chart cues elsewhere.

## Synthesis decision

Pending the parent’s cross-prototype synthesis. This candidate contributes the
compact roster, inline editor, honest activity labels, and source binding footer.

## Tradeoffs accepted

- Accept a longer vertical page during editing in exchange for keeping the
  edited voice next to its sheet context and avoiding a modal/drawer on a phone.
- Accept small unassigned avatars in performance view in exchange for stable pad
  hierarchy; artwork grows only when editing.
- Accept a separate library disclosure in exchange for keeping AF voices already
  represented by pads from being duplicated in the ensemble at rest.

## Alternatives considered

A fixed right inspector keeps multiple rows visible on desktop but becomes a
second navigation mode on narrow screens. A large character-card shelf exposes
artwork well but elevates other parts to the same visual importance as pads.
Automatic “playing” detection from nonempty cells was rejected because the row
text is an authored cue, not an observed sound.

## Open questions and risks

How should moved sheet rows be reconciled against a saved binding? Should a voice
be reusable across multiple songs through an explicit binding picker? The final
storage implementation must prove reload/export/import and report actual saved
state; this memory-only study does not establish persistence.

## Best grafts for a final version

1. Use these 64px ensemble rows and source-aware statuses as the resting view.
2. Borrow a richer character picker from another candidate inside this inline
   inspector; keep the unassigned state and approved asset ID underneath.
3. Borrow an ordered stage strip or compact effect summary from another design,
   while retaining clear per-voice save versus native apply states.
4. Keep the library-level export beside its count and management control, rather
   than in performance transport.

## Verification

esbuild produces the runnable module. Strict standalone TypeScript checking
passes. Visual and interaction inspection is reserved for the parent’s shared
browser pass. No browser processes, devices, repo files, or commits were created
by this candidate.
