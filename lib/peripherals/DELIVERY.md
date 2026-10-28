# Consume complete engine light publications

[peripheral_light_delivery.h](include/peripheral_light_delivery.h) defines a hardware-free delivery gate for complete PE light publications. It validates the engine's shared publication schema and prepares I-PAC brightness reports for explicit mappings. It does not choose patterns, advance phase, infer BPM, open a device, or write an enable mask.

## Connection identity and freshness

`pp_light_delivery_create` allocates a gate outside audio processing. Give each gate one owner. Serialize binding, preparation, device delivery, and commit through that owner. `pp_light_delivery_destroy` releases the gate.

`pp_light_delivery_bind` installs an explicit logical-ID-to-SDK-channel map and a `pp_light_connection`. All connection fields are exact positive integers at most `2^53 - 1`:

- `engine_incarnation` identifies one engine instance. The caller must never reuse this identity for a different engine.
- `device_session` identifies the actual device connection.
- `binding_revision` identifies the installed output mapping.
- `request_fence` identifies the current snapshot-request generation for this binding. Capture it when issuing each getter request. Request fences strictly increase across binds.

Capture the connection tuple when requesting a fresh getter response. Do not relabel a cached image or queued response with the newest connection tuple. Binding invalidates pending delivery frames and resets freshness for the new device or map. It retains the latest observed sequence and immutable image for the same engine incarnation. An unchanged current image can therefore initialize a new device, while an older image cannot roll the source backward.

Mappings have unique logical IDs and unique SDK channels from 0 through 95. Up to 96 mappings are supported. These are caller-supplied bindings, not observed wiring defaults. The caller must clear outputs removed from its ownership before changing mappings. Binding alone sends nothing.

## Prepare and commit a frame

1. Fetch a current complete PE publication with the connection fence captured at request time.
2. Call `pp_light_delivery_prepare` with that tuple, publication, and its exact field count.
3. If preparation returns `1`, deliver every report in the prepared frame through the host's validated output interface.
4. Call `pp_light_delivery_commit` only after every report succeeds.

The gate prepares one report per owned mapping. A logical ID absent from the complete image produces level zero. Present normalized levels are rounded to the nearest integer from 0 through 255. Unmapped IDs are ignored. Reports contain brightness writes only, so this gate does not disable seven peers through the diagnostic enable command. Correct output initialization and enable-mask ownership remain the device adapter's responsibility.

A failed write must not commit. The same unchanged pending image can be prepared again to retry the complete frame. These brightness assignments are idempotent. A newer prepared image supersedes the earlier pending frame. Discard superseded frames before starting their device writes. The gate cannot undo a report already written by an external caller.

Successful commit advances delivered freshness. Duplicate committed images and older publications return `PP_STALE`. A modified frame returns `PP_INVALID`. An equal-sequence image with different content is invalid, including after a same-engine rebind. Failure leaves gate state and output unchanged.

## Publication validation and counter bounds

The validator uses [PE's standalone layout constants](../performance/include/performance_light_output.h), not a second copy of the field indexes. It requires the exact full-image length and version, legal integer identities and counters, integer sample rate from 8000 through 192000, finite beat coordinates, boolean flags, and up to 32 unique uint32 logical IDs with finite normalized levels. Unused row cells must be zero. Negative count-beat coordinates are accepted without interpretation.

The maximum safe publication sequence is reserved for a terminal all-off image with no pending activation. The gate accepts that image and retains its source sequence across same-engine reconnects. A new engine needs a never-reused incarnation identity before its sequence can start again. A request-fence counter cannot wrap. After exhaustion, the caller must replace the consumer context safely rather than reuse an old fence.

The gate treats musical metadata as engine-authored facts. A timeline revision does not independently imply lights off. Ordinary BPM updates must not cause the host to cancel or restart a pattern. PE owns those decisions, including the unresolved policy for its existing tempo/tap rephase paths.

## Verification and remaining integration

Portable tests exercise complete-image validation, brightness rounding, absent-ID off reports, explicit mappings through all 96 outputs, retry without commit, superseded frames, modified frames, duplicate and reordered publications, fresh connection fences, same-engine sequence preservation, and terminal counters. Native and WASM execute the same cases. No test opens a device.

This gate does not supply a host service, actual USB delivery, a reconnect watcher, a watchdog, or an automatic fail-dark guarantee. Rejecting a stale frame does not itself change a physical LED. The producer's coherent clock-backed publication and the eventual real-device delivery loop require separate integration tests. Synthetic publication tests do not establish tempo synchronization or physical timing.
