# Unassigned child cleanup failure and resolution

At source revision `99c840928bf4beaccfe79905545823efad83fcd2`, the baseline controller can release an attempt after a failed child cleanup when interruption prevented assignment to `attempt.child`.

The probe executes the actual `PersistentDesk` class and real Effect scoped acquisition. Its process service is synthetic and opens no child process or audio device. The service acquires a child, delays returning its handle, and simulates a finalizer that returns while the child remains alive. This models the external failure boundary, not a physical-device reproduction.

Observed sequence:

1. Enable starts scoped acquisition and creates a synthetic child.
2. Terminate interrupts while the handle has not returned.
3. Acquisition returns; its scoped finalizer completes without reaping the child.
4. `finished()` sees no `attempt.child`, skips `isRunning`, clears the attempt and publishes Off.
5. Enable is accepted again despite the unreaped child.

The observed result is `{ audioAfterCleanup: 'off', childrenAlive: 1, replacementDecision: 'accepted' }`. No production source mutation was used.

`controller.ts:117-118` separates the spawn effect from handle assignment. `controller.ts:84-94` checks exit only when that assignment happened. The installed `@effect/platform-node-shared/src/NodeChildProcessSpawner.ts:566-586` registers cleanup with `Effect.acquireRelease` and ignores errors from `terminateProcessGroup`. Thus successful unassigned-child cleanup is an external assumption, not an unconditional guarantee of that implementation.

The issue is resolved in `7e702341cc484193b3df6186f2eaca5371aed400`. The controller now records `not-requested`, `pending`, or `known(handle)` ownership. It marks Pending before yielding to the spawner and Known only after a handle returns. `finished()` retains a Pending attempt in Stopping with an actionable managed-service recovery message. A Known handle still requires successful exit confirmation. It never clears Pending merely because acquisition failed or a finalizer returned.

The same actual-controller probe now returns `{ audioAfterCleanup: 'stopping', childrenAlive: 1, replacementDecision: 'rejected' }`. Twelve ordinary regression cases pass, including failures before/after child creation, pre-request recovery and uncertain known-handle exit checks. The revised finite model includes unassigned cleanup failure and separately verifies `UnknownOwnershipHeld`; it no longer assumes successful reaping on that path.

This deliberately sacrifices automatic retry after an ambiguous launch failure, even if no child was created. A managed-service recovery is required. No deployment or service restart was performed. Physical cleanup, unbounded shutdown and arbitrary process groups remain outside the logical proof.

Reproduce the controller-level fault boundary from the repository root:

```sh
node --import tsx --input-type=module -e "import { probeUnassignedCleanupFailure } from './verification/native-audio/replay.ts'; console.log(await probeUnassignedCleanupFailure());"
```
