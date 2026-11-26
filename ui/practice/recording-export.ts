export async function recordingToMp3(recording: Blob, assetBase?: URL, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const decoder = new OfflineAudioContext(2, 1, 44100);
  const pcm = await decoder.decodeAudioData(await recording.arrayBuffer());
  signal?.throwIfAborted();
  const channels = Array.from({ length: pcm.numberOfChannels }, (_, index) => new Float32Array(pcm.getChannelData(index)));
  const worker = new Worker(new URL('./mp3-worker.js', assetBase ?? import.meta.url), { type: 'module' });
  let abort: (() => void) | undefined;
  try {
    return await new Promise<Blob>((resolve, reject) => {
      abort = () => reject(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data instanceof Blob && event.data.type === 'audio/mpeg') resolve(event.data);
        else reject(new Error(typeof event.data === 'string' ? event.data : 'Invalid MP3 encoder response.'));
      };
      worker.onerror = () => reject(new Error('MP3 encoder could not run.'));
      worker.onmessageerror = () => reject(new Error('MP3 encoder response could not be read.'));
      worker.postMessage({ sampleRate: pcm.sampleRate, channels }, channels.map(channel => channel.buffer));
    });
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    worker.terminate();
  }
}
