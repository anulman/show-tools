# Deterministic commands and failure ownership

Product commands execute approved rules without an agent. Harness commands automate the surrounding work and return control to Chief when that automation cannot complete. A harness fallback never approves an invalid product result.

## Command diagnostics

`scripts/lib/command-diagnostics.ts` owns the shared failure format. Domain commands supply the cause, relevant source locations, and suggested next steps. They classify known failures at their command boundary rather than reinterpret errors throughout the implementation.

| Status | Exit | Meaning | Agent response |
| --- | ---: | --- | --- |
| `blocked` | 2 | Product input or a product validation gate failed. | Present the failure and suggested next steps to the operator. Hold only the dependent operation. |
| `needs-chief` | 3 | Harness dependencies, execution, or an unexpected protocol failure prevented completion. | Hand the failure to Chief for a recovery decision. Do not interrupt the operator for routine harness repair. |

Both statuses are nonzero. Neither permits an invalid artifact to become current. Expected negative test fixtures do not require operator notifications. An unexpected failure during an operator-requested product operation does.

The version-one record contains `schemaVersion`, `status`, `code`, `message`, `nextSteps`, and `locations`. Codes use stable upper-snake names. A message and at least one next step must contain non-whitespace text. Locations are an array, empty when no source location applies.

Commands supporting `--json` write one failure record to stdout. Human diagnostics go to stderr and include the same cause, locations, and next steps. Routine logs must not corrupt JSON output. Do not expose credentials or raw stacks by default.

For example, unsupported chart notation is a product block with a worksheet cell and a correction path. An unavailable C++ compiler is a Chief handoff. Invalid rendered PCM is a product validation failure; a renderer that could not run has not established whether the PCM is valid.

An agent driving a blocked product command must explain the failure in the conversation. It must not silently change the operator's notation, artwork, musical choices, or hardware facts. It can continue independent work. Chief can repair a harness, select a verified alternate procedure, or diagnose a defective check. Chief cannot bypass a valid product invariant.

## First implementation wave

Temporary forks own separate checkouts and file ranges. They do not interrupt their source sessions or take over live services. Shared diagnostics and project guidance have one coordinator owner.

| Pipeline | Bounded milestone | Required proof |
| --- | --- | --- |
| Charts | Reuse the existing parser/compiler. Compile JSON, then encode that exact inspected JSON as native bytes. Remove the two-output compile mode. | Repeatable bytes, source-cell diagnostics, input/output alias rejection, and preservation of previous outputs on failure. |
| Auditions | Render explicit synthetic or supported WAV input through shared C++ effects with declared gains, arithmetic downmix, and an exact duplicate control. | Repeatable audio and semantic manifest, independent downmix/gain checks, valid WAVs, and no partial valid pack after failure. |
| Figma | Keep strict canonical pixel, visible-scene, layer, and HOLD validation. Publish complete generated read sets and optional reports. | Existing valid output survives failure, concurrent publication is safe, and JSON diagnostics remain parseable. No art edits or promotion by fallback. |
| CAD | Wrap one allowlisted headless recipe using its existing validator and exporter. | Failed product checks prevent a success receipt; prerequisites and protocol faults hand off to Chief. No geometry or live publication changes. |

These are command and artifact changes. They do not move musical decisions out of C++, add a relay dependency, choose a database host, or authorize service lifecycle changes.

## Later harness work

Candidate handoff discovery, verification environment setup, reusable check results, viewer targeting, and delivery capture remain separate harness improvements. They must follow the `needs-chief` path when automation fails. Do not make operator performance depend on their availability.

Retain useful recoveries as concise instructions or focused regression cases. Do not create a permanent archive of every run. Follow [the retention policy](../data-retention.md).

## Delivery status

The shared diagnostic contract and all four bounded command milestones are implemented and merged. The [development guide](../development.md#run-deterministic-product-commands) collects the command entry points and focused checks.

Review reproduced and corrected unsafe audition reads, incomplete renderer replies, and silent CLI startup through macOS path aliases. Regression cases exercise those failures without changing operator inputs. Verification uses synthetic audio, copied animation fixtures, and isolated CAD outputs; it does not establish physical audio quality, live Figma equivalence, or installed hardware fit.

Preboot failures such as a missing Node executable or loader occur before these command handlers can format a record. An agent driving the command must hand those failures to Chief. Commands do not claim power-loss durability or provide an independent backup.
