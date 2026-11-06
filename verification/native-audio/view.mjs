export const title = 'Native audio ownership and cancellation';
export function state(v) {
  if (v.phase === 'ready' && v.current !== v.viewAttempt) return 'Ready names a different attempt';
  if (v.badEvent) return 'Canceled observer published';
  if (v.commandResult === 'applied' && !v.commandValid) return 'Late control reported Applied';
  const unknownReleased = v.current === 0 && v.requested.some(a => !v.assigned.includes(a) && v.stage[a] === 'done');
  if (unknownReleased && v.alive.length) return 'Unknown launch released with child alive';
  if (unknownReleased) return 'Unknown launch released without exit evidence';
  if (v.current === 0 && v.alive.length) return 'Audio off while child remains';
  if (v.phase === 'ready' && v.terminated.includes(v.current)) return 'Canceled startup reopened';
  if (v.phase === 'stopping' && Object.values(v.stage).includes('blocked'))
    return v.requested.some(a => !v.assigned.includes(a) && v.stage[a] === 'blocked') ? 'Launch ownership uncertain' : 'Cleanup unconfirmed';
  return { off: 'Audio off', fault: 'Audio fault', starting: 'Opening audio', ready: 'Audio ready', stopping: 'Stopping audio' }[v.phase];
}
export function step(action, from) {
  if (action === 'FinishExited') {
    if (!from.requested.includes(from.current)) return 'No child was requested';
    if (!from.assigned.includes(from.current)) return 'Ownership released without a handle';
    return from.alive.includes(from.current) ? 'Exit check bypassed' : 'Child exit confirmed';
  }
  return ({
    Enable: 'Enable audio', SetupFailed: 'Startup prerequisite fails', BeginSpawn: 'Request child',
    ChildAcquired: 'Process starts before handle returns', Spawn: 'Handle becomes known',
    PrepareDone: 'Song package prepared', PublishReady: 'Stopped readback verified',
    Terminate: 'Terminate audio', NativeExit: 'Child exits', BeginCleanup: 'Scoped attempt finishes',
    SpawnFailed: 'Launch returns without a handle', HoldPending: 'Unresolved launch retained',
    CleanupUnconfirmed: 'Exit cannot be confirmed', IssueCommand: 'Send control',
    ReturnCommand: 'Control returns', DeliverEvent: 'Native event arrives',
  })[action] ?? action;
}
