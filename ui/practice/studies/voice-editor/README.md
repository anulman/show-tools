# Voice editor design studies

These three runnable layout studies use explicit sample states. They do not connect to audio or durable storage. The supported page remains the practice desk.

- **A:** compact ensemble roster and inline inspectors. Retained: row proportions, generous effect controls, saved/applied language.
- **B:** avatar cast cards and a shared side editor. Retained: one editor, independent character/frame appearance, sticky footer.
- **C:** score strips and a source-oriented library. Retained: source roster, native mobile voice selector, explicit Dry/Unassigned states.

The final `voice-library.ts` combines these ideas. It does not ship one study unchanged. See [the independent comparison](judgment.md) for the graft decisions and rejected elements. Prototype character choices and cues are illustrative; none become production assignments.

To run a study, bundle its TypeScript beside its HTML with esbuild (`a/app.ts`, `b/prototype.ts`, or `c/prototype.ts`), then serve this directory from an isolated local preview. The parent comparison used 1440px and 390px Safari responsive viewports. B's tall cards and small actions lost to A/C's compact rows and 44px controls; C's voice selector worked better on a phone. The final implementation uses native dialog focus containment and a full-width mobile editor.
