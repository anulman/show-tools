# Offline scene effects

`fx.ts` contains pure functions for authoring scene studies. Callers supply explicit seconds, presentation windows, source pixels and beam progress. The module does not read a chart, schedule music, alter sprite drawings, publish Figma assets or run in the application.

The API retains the reviewed Scene 1 effect algorithms. `palette.ts` retains their exact gradient palette. The functions have no filesystem, Figma, renderer or Performance Engine dependency.

## Chorus envelope

`chorusState(timeSeconds, windows, config)` returns visibility, opacity, normalized clone spacing and the supplied window provenance. Each `ChorusWindow` supplies its own expansion finish and window end. Faster expansion and contraction start later while retaining those endpoints.

The default fade-in, expansion, contraction and fade-out durations are 100ms. The operator confirmed that the approximately 100ms fade-out starts at the marked rotary window's end. Expansion and contraction durations remain presentation defaults for review. This module does not establish rotary eligibility, hardware bindings or observed performance activity.

## Moon surface

`tintSurfaceRgba` returns one RGBA array with the original dimensions and alpha. Transparent RGB cells also remain exact. Amount zero returns the original pixel values. The function shades only occupied source pixels with the diagonal gradient.

The scene composer owns the rule that there is one moon. It applies this surface operation to that moon and does not create moon multiplier copies.

## Radial beam

`createBeamGeometry` fixes the pivot at the supplied point on the moon. `offscreenExitPoint` supplies the initial direction toward the lower-left exit; it is not a pivot. At zero progress, a narrow angular slice widens from the moon toward that exit.

`beamMaskAt` increases both angular boundaries equally about the fixed moon point. The radius is fixed and reaches every canvas corner. Each boundary reaches 180 degrees from the initial axis at full progress, including the view behind the moon point; a corner-only angle bound would leave an uncovered sector because the pivot is inside the view. The final mask covers every native cell in both tested aspect ratios. Pixel cells remain binary, and the caller chooses integer display scaling.

`beamRgbaAt` applies the diagonal gradient during expansion and the downward gradient at full takeover. The scene composer owns progress scheduling, including any initial thin-slice hold and character fade. These functions do not assign a song cue or duration.

## Verification and status

Run the focused checks from the repository root:

```sh
node --import tsx --test scripts/tests/scene-authoring-effects.test.ts
npm run typecheck
```

The checks cover late fast transitions with unchanged endpoints, the window-end tail, exact surface alpha and protected pixels, radial symmetry, monotonic growth, full takeover coverage and invalid dimensions. Caller composition still needs actual Figma and decoded-video review. Passing these utility tests does not approve artwork, new poses, tween timing, scene continuity or runtime use.
