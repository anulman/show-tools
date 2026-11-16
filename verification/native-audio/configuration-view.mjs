export const title = 'Song configuration and audio ownership';
export function state(v) {
  if (v.pending.length > 1) return 'Two configurations are preparing';
  if (v.badRevision) return 'An old desk revision was accepted';
  if (v.badCommit) return 'Closing desk committed a configuration';
  if (v.closed && v.pending.length) return 'Close returned before preparation settled';
  if (v.current && v.pending.length) return 'Audio owns an attempt while configuration prepares';
  if (v.pending.length && v.phase !== 'off') return 'Configuration prepares before audio is Off';
  if (v.closed) return 'Desk closed';
  if (v.closing && v.pending.length) return 'Closing waits for configuration';
  if (v.pending.length) return 'Preparing song or button map';
  if (v.closing) return v.current ? 'Closing waits for audio exit' : 'Finishing close';
  return { off: 'Audio off', starting: 'Opening audio', ready: 'Audio ready', stopping: 'Stopping audio', fault: 'Audio fault' }[v.phase];
}
export function step(action, from, to) {
  if (action === 'FinishConfigure') return to.commits > from.commits ? 'Prepared configuration commits' : 'Preparation or commit rejected';
  return ({ Enable: 'Enable audio', NativeReady: 'Stopped readback verified', Terminate: 'Terminate audio',
    ConfirmExit: 'Owned child exit confirmed', ConfirmedFailure: 'Startup or child fails with exit confirmed',
    ClearFault: 'Turn audio off', BeginConfigure: 'Select song or save buttons', BeginClose: 'Close the desk',
    ConfirmClosed: 'Owned work settled' })[action] ?? action;
}
