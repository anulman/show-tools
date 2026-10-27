# Peripheral ownership and design choice

The operator needs a complete wiring test without choosing song meanings from key labels or normalizing SpinTrak into gain. Performance Engine remains the sole musical resolver and clock. Host adapters report actual device observations and execute explicit output commands.

Two independent sketches compared an opaque runtime owning inputs and lights with an input latch plus stateless light evaluation. The independent cross-judge preferred the latter. This implementation uses that design with the other sketch's explicit unknown/released/held reconnect state and a small opaque input handle for straightforward WASM calls. Preparation may allocate. Observation and light functions do not allocate or run timers.

The public API hides latch and sequence state. It returns one result per observation rather than adding another queue. Consumers keep original identities, timestamps, distance units, and binding revision. This follows Model the Domain and Boundary Discipline. A peripheral input record is not an engine command acknowledgment.

The light API accepts explicit elapsed coordinates and profile parameters. It does not store snapshots, extrapolate BPM, retain a previous baseline, or decide overlap priorities. This makes duplicate sampling independent of consumer cadence. Adding a runtime that owns beat forecasts would duplicate Performance Engine; adding a second JavaScript light scheduler would weaken native/WASM agreement.

The native probe separates actual IO from the portable core and tests. It reads macOS IOKit or Linux evdev observations without exclusive grabs. Its explicit LED subcommand uses an observed descriptor and the manufacturer-sourced brightness encoder. It exposes no configuration, script-storage, or firmware commands. The operator must confirm wiring before invoking it.

The accepted tradeoff is that PE must supply resolved semantic state, timing, session/epoch validity, and approved light profiles before production integration. Raw input and LED wiring checks remain useful independently. Synthetic fixtures select their own values and mappings and do not establish production choices or real-device behavior.
