import { PF as LIGHT } from '../../performance/light-abi.js';

export function lightFixture(level = 0): number[] {
  const image = Array<number>(LIGHT.LIGHT_FIELDS).fill(0);
  image[LIGHT.LIGHT_FORMAT] = LIGHT.LIGHT_VERSION;
  image[LIGHT.LIGHT_GENERATION] = 1;
  image[LIGHT.LIGHT_EPOCH] = 1;
  image[LIGHT.LIGHT_SEQUENCE] = 1;
  image[LIGHT.LIGHT_RATE] = 48000;
  image[LIGHT.LIGHT_COUNT] = 1;
  image[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_ID] = 1;
  image[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_LEVEL] = level;
  return image;
}
