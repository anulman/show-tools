# MP3 encoder dependencies

MP3 exports use `wasm-media-encoders` 0.7.0, licensed under MIT. Its bundled LAME encoder is **LGPL-2.0-or-later (copyleft)**. This is an explicit exception to the preference for permissive dependencies. Browser-native MediaRecorder does not provide a portable MP3 encoder.

- [Wrapper license](wasm-media-encoders-MIT.txt) and [source/build scripts](https://github.com/arseneyr/wasm-media-encoders/tree/v0.7.0).
- [LAME license](LAME-LGPL-2.0.txt) and [LAME source](https://github.com/arseneyr/lame/tree/98db548e8e851defbba3184125ce10725355c332).

The package's MP3 WASM is bundled unmodified into `mp3-worker.js`. To replace it, change the encoder import in `ui/practice/mp3-encoder.ts` or rebuild the upstream encoder, then run `npm run build:ui`. The worker runs only after capture ends. No recording is sent to a server.
