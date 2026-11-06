import { PF } from '../../performance/wasm-abi.js';
import { decodeTunerState } from '../../tuner/observation.js';
export function tunerImageFixture() {
  const values = Array<number>(PF.TUNER_FIELDS).fill(0);
  values[PF.TUNER_COUNT] = 2;
  for (let index = 0; index < 2; index++) {
    const offset = PF.TUNER_TARGETS + index * PF.TUNER_TARGET_FIELDS;
    values[offset] = 60 + 12 * index;
    values[offset + 1] = 67;
    values[offset + 3] = 4 + index;
  }
  return values;
}
export const tunerFixture = () => decodeTunerState(tunerImageFixture());
