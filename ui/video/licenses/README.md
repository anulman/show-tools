# Video dependencies

The browser gallery uses PixiJS 8.22.0 under the MIT license. The video WASM utility is repository code and has no host imports. Effect remains the repository's MIT-licensed boundary-validation dependency.

The pose authoring script uses sharp 0.35.5 under Apache-2.0. Its native image backend, libvips, is LGPL-2.1-or-later. This authoring dependency does not enter the browser bundle or the audio processing module. Preserve the installed dependency notices if distributing that toolchain.

The four-second demo artifact was encoded with the operator's installed GPL-enabled FFmpeg and libx264. No FFmpeg executable, encoder library, or Remotion code is bundled with the gallery. The video file is a rendered output, not a redistributed toolchain.

All source and derived character assets are cleared for publication by the operator in PR #4. Exact generation prompts, source checksums, and page references are in `assets/video/manifest.json`. Generated Original treatments match the source style but do not claim pixel-identical extraction.
