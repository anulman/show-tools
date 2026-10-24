export function beatTrackerClock(tracker) {
  if (!tracker?.context || typeof tracker.subscribe !== 'function') {
    throw new TypeError('A beat tracker with an audio context is required');
  }
  return {
    now: () => tracker.context.currentTime,
    subscribe(listener) {
      return tracker.subscribe((state, events = []) => {
        const rate = state.sampleRate || tracker.context.sampleRate;
        const origin = state.contextFrame - state.frame;
        listener({
          now: tracker.context.currentTime,
          available: state.lifecycle === 'running' && state.started === true &&
            Number.isFinite(origin) && Number.isFinite(rate) && rate > 0,
          epoch: state.epoch ?? null,
          droppedEvents: state.droppedEvents ?? 0,
          beatId: state.beatId ?? 0,
          beats: events.filter(event => event.type === 'clock' && event.epoch === state.epoch)
            .map(event => ({ id: event.id, at: (origin + event.frame) / rate })),
        });
      });
    },
  };
}
