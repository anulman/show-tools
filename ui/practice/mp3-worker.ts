/// <reference lib="webworker" />
import { encodeMp3, isTakePCM } from './mp3-encoder.js';

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = async (event: MessageEvent<unknown>) => {
  try {
    if (!isTakePCM(event.data)) throw new Error('Invalid audio for MP3 export.');
    self.postMessage(await encodeMp3(event.data));
  } catch (error) {
    self.postMessage(error instanceof Error ? error.message : 'MP3 encoding failed.');
  }
};
