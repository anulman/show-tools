import assert from 'node:assert/strict';
import test from 'node:test';
import { probeUnassignedCleanupFailure, replayAcquisitionCancellation, replayAcquisitionFailures, replayPreSpawnRecovery, replayCancelBeforeRequest, replayFailedExitQuery, replay } from '../../../verification/native-audio/replay.js';

test('unassigned child cleanup failure retains attempt and rejects replacement', async () => {
  assert.deepEqual(await probeUnassignedCleanupFailure(), { audioAfterCleanup: 'stopping', childrenAlive: 1, replacementDecision: 'rejected' });
});
test('canceled acquisition remains uncertain even when a synthetic finalizer reaps it', replayAcquisitionCancellation);
test('failures before and after child creation stay held until managed recovery', replayAcquisitionFailures);
test('cancellation before requesting a child returns off and permits a fresh attempt', replayCancelBeforeRequest);
test('failure before requesting a child remains recoverable without managed restart', replayPreSpawnRecovery);
test('failed exit confirmation retains ownership despite completed scope cleanup', replayFailedExitQuery);
for (const scenario of ['cancel', 'cleanup', 'command', 'observe', 'ownership', 'identity'] satisfies Array<'cancel' | 'cleanup' | 'command' | 'observe' | 'ownership' | 'identity'>)
  test(`actual controller ${scenario} schedule preserves lifecycle safety`, () => replay('none', scenario));
