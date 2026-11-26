import type { RequiredTuningBank, TunerPort, TunerState } from '../../lib/tuner/model.js';

export function matchesTuningBank({ root, scale, targets }: TunerState, capture: RequiredTuningBank): boolean {
  return root === capture.target.root && scale === capture.target.scale && targets.length === capture.slots.length;
}

export async function recordRequiredTuningBank(port: TunerPort, capture: RequiredTuningBank, signal: AbortSignal): Promise<void> {
  if (!port.beginRequiredBank) throw new Error('This audio session cannot record the required tuning scale.');
  signal.throwIfAborted();
  const initial = await port.beginRequiredBank(capture);
  signal.throwIfAborted();
  if (!matchesTuningBank(initial, capture) || !initial.listening || initial.complete)
    throw new Error('The audio engine did not begin recording the required tuning scale.');
  let unsubscribe: (() => void) | undefined;
  let removeAbortListener: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => reject(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', cancel);
      unsubscribe = port.subscribe(state => {
        if (state.revision < initial.revision) return;
        if (!matchesTuningBank(state, capture)) reject(new Error('The tuning scale changed during capture.'));
        else if (state.complete) resolve();
        else if (!state.listening) reject(new Error('The tuning session ended before all notes were recorded.'));
      });
    });
  } finally {
    unsubscribe?.();
    removeAbortListener?.();
  }
}
