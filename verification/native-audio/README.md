# Native audio lifecycle verification

The operator needs Terminate to stay terminated and controls from an old attempt to stay out of its replacement. This package checks a finite lifecycle model, replays its broken-variant paths through the actual controller, and catches deliberately changed controller guards.

Verification exposed and fixed an unassigned-child cleanup gap. [The finding and resolution](finding.md) record the old failure and the conservative pending-ownership correction. The current model explicitly includes failed acquisition and cleanup without assuming that an unknown child was reaped.

## Run

Install the pinned checker described in [the shared toolchain guide](../tools/README.md), set `JAVA` and `TLA2TOOLS`, and install this checkout's locked Node dependencies. From the repository root, run:

```sh
node --import tsx verification/native-audio/verify.ts
node_modules/.bin/tsc --project verification/native-audio
```

The checker creates a new temporary output directory and prints its receipt path. An optional final argument selects a new output directory whose parent already exists. Existing directories are refused. TLC uses one worker and a 512 MiB heap. Its local management socket may require running outside the restricted sandbox; that is a verification-environment prerequisite, not a product exception.

A successful command verifies the controller and schema source hashes in `coverage.json`, the pinned Effect/Node-platform versions and TLC JAR, the complete finite-model search, the corresponding actual-controller schedules, six ownership source mutants, and eight configuration source mutants. It writes complete TLC logs, the changed controller source variants, and a JSON receipt binding source/model/config/replay hashes and runtime version. No production file is edited. A timeout, incomplete model, unexpected invariant failure, wrong mutation assertion, or source drift fails the command.

Read every model result with the current p-stack `/statechart` skill. Its installed paths and commands are deliberately not copied here. Use `NativeAudio.tla`, `NativeAudio.cfg`, and `view.mjs` for the full proof. `Chart.cfg` reduces the domain to one attempt for an illustrative graph. That smaller graph does not replace the two-attempt proof, and hidden within-label transitions do not disappear from the checker.

## Promises and bounds

The model has two distinct, never-reused attempt identities, at most one command issued in total, one controller, and one native process per acquired attempt. Startup, child acquisition, failed or pending handle publication, preparation, delayed stopped readback, Terminate, physical child exit, cleanup, exit confirmation, command completion, and late subscribed events can occur in every enabled order. There is no depth truncation or random input sampling. No fairness or eventual-success claim is made.

| Invariant | Meaning |
| --- | --- |
| `TypeOK` | Modeled ownership and lifecycle values stay in their declared finite domains. |
| `NoCanceledReady` | A terminated attempt never publishes Ready again. |
| `ReadyIdentity` | A Ready view names the current attempt. It does not prove that the OS child remains alive between observations. |
| `OneOwnedChild` | At most one modeled child leader is live, and releasing the current attempt leaves none. |
| `UnknownOwnershipHeld` | A requested spawn without a known handle cannot release its attempt, even if no child was actually created. |
| `NoStaleApplied` | A completion is not reported Applied when its captured attempt is no longer current and Ready. |
| `NoStaleEvent` | An event from a canceled or superseded subscription is not published. |

The model treats native epochs as distinct per attempt and assumes supplied readbacks/outcomes have already passed the production schemas. UUID collisions, controller duplication in another gateway process, malformed transport payloads, socket authentication, native command ordering, Stop/Panic queue priority, ALSA/device behavior, descendants, process-kill guarantees, physical silence, and real-time latency are outside this proof. It does not prove that every model execution is a concrete controller execution or that all concrete executions refine the model.

Listener callbacks are assumed not to throw or synchronously reenter controller methods. Native handle exit checks must accurately report false only after that child leader exits; failures remain uncertain. Process identities are not reused within the bounded run.

Cleanup can remain unconfirmed. The model retains that attempt indefinitely and refuses a replacement. A spawn failure before a handle returns is deliberately sticky, even if it may have created no child. Managed-service recovery is required. Failures before the spawn request remain recoverable in process. It does not assume the OS must eventually permit a kill. The supplemental model covers the configuration wait in `close()`. Other service-shutdown integration and unconditional liveness remain separate concerns.

## Source correspondence

The sync revision and file hashes live in `coverage.json`. The checker rejects any covered source change until the model, source boundaries and replays are reviewed. Advancing a hash without that review does not establish verification.

| Model action | Controller boundary at the sync revision |
| --- | --- |
| `Enable` | `setAudio()` and the synchronous reservation and publication in `start()`. |
| `SetupFailed` | Runtime prerequisites fail before any child request; the attempt may become Fault and retry without asserting cleanup of a nonexistent request. |
| `BeginSpawn`, `ChildAcquired`, `Spawn`, `SpawnFailed` | The Pending assignment before the spawn await, physical acquisition, and Known assignment after handle return. These are separate steps; acquisition or cleanup may fail before a handle reaches the controller. |
| `PrepareDone`, `PublishReady` | The package preparation await, readback polling await, cancellation and identity checks and the synchronous Ready update. A delayed readback permits Terminate between preparation and publication. |
| `Terminate` | `stop()` publishes Stopping, sets the final goal to Off and aborts. |
| `NativeExit` | Physical child exit may precede the asynchronous completion callback. It does not immediately change the public view. |
| `BeginCleanup` | Effect scoped finalization before `finished()`. |
| `HoldPending`, `FinishExited`, `CleanupUnconfirmed` | `finished()` first retains a Pending ownership record. A Known handle then permits the real `isRunning` await and retain-versus-release branch. |
| `IssueCommand`, `ReturnCommand` | Admission before the instrument await and the current, Ready and abort recheck afterward. |
| `DeliverEvent` | The current/Ready/abort subscription gate. Only attempts that previously subscribed can emit a delayed event in the model. |

The installed Node process service registers its child finalizer before returning a handle. The actual controller awaits the whole scoped attempt before `finished()`, but completion alone does not prove reaping: the backend can ignore termination errors. The model therefore keeps Pending ownership when a request fails or interruption prevents publication of its handle. It permits the physical child to remain alive or to exit independently. The synthetic acquisition and cleanup-failure replays use real Effect scope ordering; they do not prove OS kill behavior.

## Actual-code sensitivity

`replay.ts` bundles the actual `controller.ts` and actual schemas. It substitutes the external process service, package preparation and native transport. Effect itself, including scoped acquisition/interruption, remains real. Each bundle is read from an isolated source copy and removed after the run. The synthetic services create no OS child, network connection, device or live audio. Actual filesystem work stays in a temporary private fixture.

Each TLC mutant must fail its specific named invariant. The ownership mutant has two distinct failures, so the checker extracts and replays both paths. It removes an already-broken rule only from the second mutant run to reveal that additional witness; the baseline always checks all seven invariants. Its reported action path runs against the unmodified controller and then the corresponding temporary controller mutation. The mutant must fail the specific behavioral assertion, not merely throw an arbitrary error. Additional schedules cover old results/events after a replacement and a canceled acquisition before handle assignment.

| Mutant | Real changed operation | Required failure |
| --- | --- | --- |
| `ownership` | Bypass the Pending-ownership hold in `finished()`. | An ambiguous failed launch releases ownership and accepts a replacement. |
| `cancel` | Omit `AbortController.abort()` from `stop()`. | Delayed startup publishes Ready after Terminate. |
| `cleanup` | Bypass `finished()`'s running-child hold. | Audio reports Off while the child remains, allowing a replacement. |
| `command` | Omit the post-await command completion fence. | An old completion is reported Applied after termination or replacement. |
| `identity` | Publish Ready with a different attempt identity. | Ready must preserve the reserved attempt identity. |
| `observe` | Omit the subscription admission fence. | A canceled or old subscription publishes an event. |

These are sensitivity and selected conformance checks, not a proof of every implementation interleaving. A model-only mutant is never counted as source verification. The separate unassigned-child fault probe changes no production operation and now asserts the repaired baseline remains Stopping and rejects replacement. Ordinary tests also cover launch failure before/after child creation, cancellation before handle publication, failed exit queries, and recoverable failures before a spawn request.

## Song and button-map configuration

The current source sync is `e9ecebb858dc580fb43717c3d3771d9c8c458858`. The existing ownership model remains unchanged. Configuration adds no child process or new ownership transfer. Its guarded work occurs only while audio is Off and no attempt is reserved. Hiding that work leaves a conservative ownership model because configuration can reject Enable but cannot introduce another owned attempt. This is a reviewed correspondence argument, not a mechanically checked composition or refinement proof.

`SongConfiguration.tla` checks the new promise separately. It covers two never-reused attempt reservations and two configuration requests. Each request independently supplies a current or noncurrent desk token. This equality abstraction covers both old and future tokens without bounding native telemetry's revision counter. The model's `commits` counts successful configuration completions, not numeric desk revisions. No state-depth constraint or fairness assumption is used.

| Invariant | Meaning |
| --- | --- |
| `TypeOK` | Ownership, request identities, completion counts and flags stay in the finite domain. |
| `OneConfiguration` | At most one asynchronous configuration is pending. |
| `NoOwnedConfiguration` | Pending configuration and a reserved native attempt cannot overlap. |
| `ConfigurationRequiresOff` | Configuration requires audio Off, including after a recoverable Fault. |
| `NoCommitAfterClosing` | A candidate cannot commit after shutdown begins. |
| `ClosedHasNoConfiguration` | Close cannot return with configuration still pending, and a closed desk cannot admit new configuration. |
| `NoStaleConfigurationRevision` | Admission rejects every token unequal to the current desk token. |

`BeginConfigure` corresponds to `configure()` checking closing, attempt, audio state, lock and expected revision, then reserving its promise before awaiting preparation. `FinishConfigure` corresponds to that await settling, candidate validation, the closing check, synchronous commit and in-memory activation, and the `finally` release. These synchronous operations have no modeled external interleaving. `BeginClose` reserves closing before waiting. `ConfirmClosed` represents the close promise returning after the pending configuration settles.

The coarse native states in this supplemental model retain an attempt until confirmed exit or failure. Unknown ownership can remain reserved indefinitely. The original lifecycle model and its actual-controller witnesses check that release condition in more detail. The supplemental model does not repeat acquisition, handle publication, event or command internals.

Preparation and compare-and-swap are controlled external boundaries in the configuration replay. The real controller, schemas, Effect runtime and native scope ordering remain real. A temporary private SQLite authority supplies the declared class interface, but its save method is replaced by a synchronous success or no-change failure. These checks do not prove SQLite durability, ambiguous commit errors, canonical chart compilation, asset loading or backup behavior. Listener callbacks must not throw or synchronously reenter the controller, as in the ownership proof. Trusted collaborators must not mutate validated package objects outside the controller; deep object immutability is not proved here.

The source mutants remove these guards one at a time:

| Mutation | Required real-controller failure |
| --- | --- |
| Enable during preparation | Enable reserves an attempt while a configuration is pending. |
| Configuration during audio ownership | Preparation starts while an attempt is already reserved. |
| Configuration during Fault | Preparation starts before the operator explicitly turns audio Off. |
| Configuration after Close | A closed desk admits preparation. |
| Overlapping configuration | A second preparation starts before the first settles. |
| Commit after closing begins | A prepared candidate reaches the commit callback after Close. |
| Close without its configuration wait | The close promise settles before preparation. |
| Noncurrent desk revision | Preparation starts with a valid revision token unequal to the current token. |

The replay also checks successful configuration, rejected preparation, rejected compare-and-swap, lock release, Ready and unresolved-child admission rejection, admission after confirmed exit, and rejection of a previously current token after a successful configuration. Each model counterexample has one corresponding actual-controller operation per reported action. The baseline must preserve the rule and the matching source mutant must fail its named assertion.

[configuration-illustration.mmd](configuration-illustration.mmd) shows the complete finite configuration model through reader-facing labels. It omits transitions whose endpoints share a label. The smaller `SongConfiguration-chart.cfg` remains a separate illustration check and never replaces the full two-attempt, two-request proof. The existing ownership chart and model bounds are unchanged.

## Pad-release schema maintenance

The current source record includes the explicit pad release edge introduced by `4f4e557`. The native event schema separates pad controls from Panic and tempo controls so that a pad can carry `edge: release`. The lifecycle controller, session schema, light ABI and tuner schema remain byte-identical to the previous sync. This changes accepted payload data without adding an ownership state, await or admission rule. The model, seven invariants and finite bounds remain unchanged. Adapter release delivery and held sample behavior have separate native and bridge tests.

## External-sample schema maintenance

The source record at `894915f` also includes the typed external-sample control with slot 0 through 63. The controller and the other four covered files are unchanged. External asset uploads finish inside the same attempt-owned `prepareInstalledPackage` promise before its stopped readback and Ready publication. Cancellation checks remain inside preparation and at the controller boundary after it returns. This extends validated input and package preparation data without changing the lifecycle model, its seven invariants or its bounds. The replay substitutes preparation, so native WAV decoding, upload cancellation and old-engine asset ownership require the separate integration tests.

## Consolidated practice release

All five covered source files are byte-identical between `894915f` and `cd3ae7e08c7a852b3d14766ffd9c9a6a1827aaa4`. The current release therefore remains **in sync** with this model and its replay. The coverage revision records that inspection. A baseline run and a fresh source-fenced rerun both exhaust the same 1,761 states, preserve all seven invariants and reject all six actual-controller source mutants, including both pending-ownership paths. The controller, model, replay, dependencies, properties and bounds are unchanged.

DG's periodic sustain preparation, pickup labeling, and the static UI manager are outside the covered lifecycle controller. Neither their quality nor their process behavior is established by this proof. The final receipt is `/private/tmp/practice-tonight-lifecycle-final-cd3ae7e/receipt.json`.

## Identified input observation maintenance

Outcome: **updated** at `dfd9c1fc61dd6273b08026f8f2da29516e8f58d8`. The old source fence rejected `native-schema.ts`. Review against `cd3ae7e` found that the lifecycle controller, its session schema, light ABI, tuner schema and Effect versions are unchanged. The native state schema gains optional validated input-routing observations. Its new schema and pure registry dependencies are now pinned. No ownership action, await, attempt identity, cleanup condition or command fence changed; the two-attempt, one-command model and all seven safety invariants remain unchanged.

The complete verifier passes the 1,761-state pristine graph, six actual-controller source mutants and both pending-ownership counterexample paths, with all pristine schedules passing. Receipt: `/private/tmp/routing-native-audio-final/receipt.json`. The current statechart tool interpreted the baseline, all six variants, the additional live-child ownership variant and the 86-state illustration. Every rule was checked; the illustration still has seven labels and twelve arrows.

This is lifecycle source-fence drift, not a product failure. The generic old-attempt command/observation fences still hold. The proof does not establish gateway producer allocation, native source ownership, reconnect release barriers, Panic classification or physical acceptance.

## Exact engine-exit readback maintenance

Reviewed the controller and session schema at `092ffbc` against `dfd9c1f`. The controller retains a bounded read-only retirement record only for a target that actually published Ready, after its known child handle confirms exit. It rechecks attempt identity after that await. Pending acquisition, failed exit queries and live children retain their existing ownership. No new startup or cleanup await is added. The record uses a controller revision, separately from native admission revisions.

The modeled ownership conditions and seven invariants remain unchanged. Retirement metadata is derived after the existing `FinishExited` condition, not an additional source of child-release authority. Actual controller and gateway witnesses additionally check exact target/server identity, delayed exit, uncertain acquisition and cleanup, canceled startup, old callbacks, bounded proof retention and explicit Terminate recovery. The finite model does not verify intent ledgers, cryptographic readback capabilities or browser producer recovery. Those have separate actual gateway/browser witnesses.

## Sample-export source correspondence

Reviewed the additive read path at `a831cc6`. `pf_copy_take_audio()` reads the latest committed cache only while transport is stopped and copies at most 4096 stereo frames into caller storage. The native owner admits its read against the existing admission revision without incrementing it. The controller checks the native target before and after its await. None of these paths allocates or replaces a capture bank, changes input ownership, starts transport, or writes a light baseline. Existing model transitions, properties and bounds remain unchanged. The source fences now include this reviewed code.

The existing formal models do not prove WAV/ZIP encoding or multi-chunk sample export. Actual C++ no-allocation/state-preservation checks, real WASM layered exports at 8/48 kHz and an authenticated native-host HTTP test cover those additions separately. These checks do not establish physical audio or LED acceptance.

The source refresh also incorporates the already-merged `e5fa45f` package-validator refactor: `parseManifestProgram()` returns the validated compiled packet once, replacing a second encoding pass. The validator still rejects mismatched packet/profile digests and song identity before host preparation. It adds no ownership state or await; that external preparation boundary and the existing model bounds remain unchanged.
