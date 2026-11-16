import type { PracticeState } from '../../lib/performance/model.js';
import type { InputAttachArgs, InputEventArgs, InputRevokeArgs } from './musical-input-policy.js';

export interface MusicalInputEndpoint {
  readonly inputScope: string;
  readonly requiresInputRetirementProof?: boolean;
  snapshot(): PracticeState;
  inputAttach(args: InputAttachArgs): Promise<PracticeState>;
  inputEvent(args: InputEventArgs): Promise<PracticeState>;
  inputRevoke(args: InputRevokeArgs): Promise<PracticeState>;
}

export function createMusicalInputProducer(options: {
  readonly kind: InputAttachArgs['kind'];
  readonly endpoint: () => Promise<MusicalInputEndpoint>;
  readonly releasedMask: number;
}) {
  let revision = 0;
  let paused = false;
  let active: { endpoint: MusicalInputEndpoint; bindingGeneration: number; sequence: number; revision: number; phase: 'unconfirmed' | 'admitted' } | undefined;
  let pending: Promise<void> = Promise.resolve();
  function enqueue(action: () => Promise<void>) {
    const result = pending.then(action, action);
    pending = result.catch(() => {});
    return result;
  }
  function reset() {
    revision++;
    return enqueue(async () => {
      const previous = active;
      if (previous) { await previous.endpoint.inputRevoke({ kind: options.kind }); active = undefined; }
    });
  }
  return {
    event(input: number, value: number) {
      if (paused) return Promise.resolve();
      const requested = revision;
      return enqueue(async () => {
        if (requested !== revision) return;
        const endpoint = await options.endpoint();
        if (requested !== revision) return;
        const routing = endpoint.snapshot().inputRouting;
        if (!routing) throw new Error('Native input routing is unavailable');
        if (active && active.endpoint.inputScope !== endpoint.inputScope && !active.endpoint.requiresInputRetirementProof) active = undefined;
        if (active && (active.endpoint !== endpoint || active.bindingGeneration !== routing.bindingGeneration || active.revision !== requested || active.phase !== 'admitted')) {
          const previous = active;
          await previous.endpoint.inputRevoke({ kind: options.kind });
          active = undefined;
          if (requested !== revision) return;
        }
        if (!active) {
          active = { endpoint, bindingGeneration: routing.bindingGeneration, sequence: 0, revision: requested, phase: 'unconfirmed' };
          await endpoint.inputAttach({ kind: options.kind, bindingGeneration: routing.bindingGeneration,
            releasedMask: options.releasedMask, heldMask: 0 });
          active.phase = 'admitted';
          if (requested !== revision) { await endpoint.inputRevoke({ kind: options.kind }); active = undefined; return; }
        }
        if (active.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Input sequence exhausted; release and reconnect this input source');
        await active.endpoint.inputEvent({ kind: options.kind, bindingGeneration: active.bindingGeneration,
          sequence: ++active.sequence, input, value });
      });
    },
    reset,
    pause() { paused = true; return reset(); },
    resume() { paused = false; },
  };
}
