type State = {
  active: number; activeBank: number;
  latest: Record<string, number>; playing: Record<string, Record<string, boolean>>;
  published: Record<string, number>;
  event: { kind: string; valid: boolean; ready: boolean; take: number; bank: number; gen: number };
};
export const title = 'Capture handoff and retained takes';
export function state(value: State): string {
  const event = value.event;
  if (event.kind === 'combined' && !event.ready && value.active === 0) return 'Rejected handoff lost the outgoing recording';
  if (value.active !== 0 && value.latest[value.active] === value.activeBank) return 'Recording over the retained bank';
  if (['independent', 'automatic'].includes(event.kind) && !event.valid && value.active !== 0) return 'Invalid outgoing draft admitted a new recording';
  if (event.kind === 'automatic' && event.valid && value.published[event.gen] === 0) return 'Written endpoint left the capture unfinished';
  if (['commit', 'combined', 'independent', 'automatic'].includes(event.kind) && event.valid && (event.kind !== 'combined' || event.ready)
    && !value.playing[event.take][event.bank]) return 'Committed take did not autoplay';
  if (event.kind === 'fault') return 'Stopped after resource failure';
  if (value.active !== 0) {
    if (event.kind === 'combined' && !event.ready) return 'Recording preserved after rejected handoff';
    return Object.values(value.latest).some(bank => bank !== 0) ? 'Recording with a retained take' : 'Recording first take';
  }
  if (Object.values(value.playing).some(banks => Object.values(banks).some(Boolean))) return 'Retained take playing';
  return Object.values(value.latest).some(bank => bank !== 0) ? 'Stopped with a retained take' : 'Ready to capture';
}
export function step(action: string, _from: State, to: State): string {
  if (action === 'Begin') return 'you arm an available take';
  if (action === 'StopComplete') return 'you stop with a complete draft, retaining it without playback';
  if (action === 'Finish') return 'valid capture commits and autoplays';
  if (action === 'Combined') return to.event.ready ? 'combined commit and arm succeeds' : 'combined handoff rejects unavailable target';
  if (action === 'Boundary') {
    if (!to.event.valid) return 'invalid outgoing draft blocks incoming capture';
    if (to.event.kind === 'automatic') return to.event.ready ? 'written endpoint commits and starts next take' : 'written endpoint commits without incoming capture';
    return to.event.ready ? 'standalone commit then independent arm succeeds' : 'standalone commit survives failed independent arm';
  }
  if (action.startsWith('Fault')) return 'resource failure stops the operation';
  return action === 'Done' ? 'the bounded run is complete' : 'you stop, discarding only an incomplete draft';
}
