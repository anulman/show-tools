import { Schema } from 'effect';
import type { InputAttach, InputEvent } from '../../lib/performance/input-bindings.js';

const Policy = Schema.Literals(['unselected', 'keyboard', 'native-controls']);
export type MusicalInputPolicy = typeof Policy.Type;
export type InputAttachArgs = Omit<InputAttach, 'producer' | 'session'>;
export type InputEventArgs = Omit<InputEvent, 'producer' | 'session'> & { readonly kind: InputAttach['kind'] };
export type InputRevokeArgs = { readonly kind: InputAttach['kind'] };
const decodePolicy = Schema.decodeUnknownOption(Policy);
const storageKey = 'show-tools-musical-input-policy';
export const musicalInputPolicyEvent = 'show-tools-musical-input-policy';
let clientSelection: MusicalInputPolicy | undefined;
type PolicyStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function currentMusicalInputPolicy(storage?: PolicyStorage): MusicalInputPolicy {
  if (!storage && clientSelection) return clientSelection;
  try {
    const value = decodePolicy((storage ?? sessionStorage).getItem(storageKey));
    return value._tag === 'Some' ? value.value : 'unselected';
  } catch { return 'unselected'; }
}

export function createMusicalInputPolicy(options: { storage?: PolicyStorage; changed?: () => void } = {}) {
  let selection = currentMusicalInputPolicy(options.storage);
  return {
    selection: () => selection,
    allowsDomInput: () => selection === 'keyboard',
    select(value: unknown) {
      const decoded = Schema.decodeUnknownSync(Policy)(value);
      if (selection === decoded) return;
      selection = decoded;
      if (!options.storage) clientSelection = selection;
      try { (options.storage ?? sessionStorage).setItem(storageKey, selection); } catch {}
      options.changed?.();
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(musicalInputPolicyEvent));
    },
  };
}
