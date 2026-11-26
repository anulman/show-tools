import { zipSync, strToU8 } from 'fflate';
import type { CompiledSong } from '../../lib/performance/compiled-song.js';
import type { PracticeState } from '../../lib/performance/model.js';
import { decodeTakeAudio, TAKE_AUDIO_CHUNK_FRAMES, type TakeAudioRequest } from '../../lib/performance/take-audio.js';

type ExportState = Pick<PracticeState, 'phase'> & Partial<Pick<PracticeState, 'compiledTakes' | 'recording' | 'runId' | 'preflightStage'>>;
type SampleSource = { takeAudioToken(): string; takeAudio(request: TakeAudioRequest): Promise<Uint8Array> };
const WAV_HEADER_BYTES = 58;
const MAX_EXPORT_BYTES = 128 * 1024 * 1024;
export function sampleFileName(value: string) { return value.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'voice'; }

function canDownload(state: ExportState) {
  return !state.preflightStage && state.phase !== 'playing' && state.phase !== 'count-in' && !state.recording;
}

function capturedSamples(song: CompiledSong | undefined, state: ExportState) {
  const captures = new Map(state.compiledTakes?.map(take => [take.index, take]));
  return song?.takes.flatMap((take, index) => {
    const captured = captures.get(index);
    return captured?.ready && captured.frames > 0 ? [{ take, index, captured }] : [];
  }) ?? [];
}

export function voiceSampleArchive(song: CompiledSong, voiceId: string, state: ExportState, source: SampleSource) {
  return selectedSampleArchive(song, [voiceId], state, source);
}

export async function selectedSampleArchive(song: CompiledSong, voiceIds: readonly string[], state: ExportState, source: SampleSource) {
  if (!canDownload(state)) throw new Error('Stop practice before downloading samples');
  const requested = new Set(voiceIds);
  const available = capturedSamples(song, state).filter(({ take }) => requested.has(take.voiceId));
  if (!available.length) throw new Error(requested.size === 1 ? 'This voice has no captured samples' : 'The selection has no captured samples');
  const exportedVoiceIds = [...new Set(available.map(({ take }) => take.voiceId))];
  if (available.reduce((sum, { captured }) => sum + captured.frames * 8 + WAV_HEADER_BYTES, 0) > MAX_EXPORT_BYTES) {
    throw new Error(exportedVoiceIds.length === 1
      ? 'This voice exceeds the 128 MiB sample download limit'
      : 'Selected samples exceed the 128 MiB download limit. Uncheck some voices and retry.');
  }
  const token = source.takeAudioToken();
  const files: Record<string, Uint8Array> = {};
  const samples = [];
  for (const { take, index, captured } of available) {
    const wav = new Uint8Array(WAV_HEADER_BYTES + captured.frames * 8), header = new DataView(wav.buffer);
    let rate = 0;
    for (let offset = 0; offset < captured.frames; offset += TAKE_AUDIO_CHUNK_FRAMES) {
      const frames = Math.min(TAKE_AUDIO_CHUNK_FRAMES, captured.frames - offset);
      const chunk = decodeTakeAudio(await source.takeAudio({ take: index, offset, frames, token }));
      if (source.takeAudioToken() !== token || chunk.totalFrames !== captured.frames || chunk.frames !== frames || rate && rate !== chunk.sampleRate)
        throw new Error('Practice samples changed during download. Stop practice and retry.');
      rate = chunk.sampleRate; wav.set(chunk.pcm, WAV_HEADER_BYTES + offset * 8);
    }
    const text = (offset: number, value: string) => wav.set(strToU8(value), offset);
    text(0, 'RIFF'); header.setUint32(4, wav.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    header.setUint32(16, 18, true); header.setUint16(20, 3, true); header.setUint16(22, 2, true);
    header.setUint32(24, rate, true); header.setUint32(28, rate * 8, true); header.setUint16(32, 8, true); header.setUint16(34, 32, true);
    header.setUint16(36, 0, true); text(38, 'fact'); header.setUint32(42, 4, true); header.setUint32(46, captured.frames, true);
    text(50, 'data'); header.setUint32(54, wav.length - WAV_HEADER_BYTES, true);
    const file = `${String(index + 1).padStart(2, '0')}-${sampleFileName(take.sourceName || take.id)}.wav`;
    files[file] = wav; samples.push({ file, sampleRate: rate, frames: captured.frames, capture: take });
  }
  if (source.takeAudioToken() !== token) throw new Error('Practice samples changed during download. Stop practice and retry.');
  const exportedVoices = new Set(exportedVoiceIds);
  const manifest = exportedVoiceIds.length === 1
    ? { kind: 'captured-voice-samples', voiceId: exportedVoiceIds[0] }
    : { kind: 'captured-samples', voiceIds: exportedVoiceIds };
  const { kind, ...voiceFields } = manifest;
  files['samples.json'] = strToU8(JSON.stringify({ schemaVersion: 1, kind, songId: song.id, sourceDigest: song.source.digest,
    ...voiceFields, runId: state.runId, audio: 'Stereo float32 WAV; committed processed capture, before playback gain and sequencing. Not a rendered channel performance.',
    availability: 'Latest committed bank for each captured chart take; earlier recaptures and uncaptured live channels are not retained.',
    samples, selections: song.selections.filter(value => exportedVoices.has(value.voiceId)), playback: song.playback.filter(value => exportedVoices.has(value.voiceId)) }, null, 2) + '\n');
  return zipSync(files, { level: 0, mtime: new Date(1980, 0, 1) });
}

export function createSampleDownloads(root: HTMLElement, current: () => { song: CompiledSong | undefined; state: ExportState; source: SampleSource | undefined }, onBusyChange: () => void = () => {}) {
  const section = document.createElement('section'); section.className = 'sample-downloads'; section.hidden = true;
  section.setAttribute('aria-label', 'Voice sample downloads');
  const title = document.createElement('h2'); title.textContent = 'Voice samples';
  const hint = document.createElement('p'); hint.textContent = 'Stop transport to download captured samples. Download before terminating audio or changing songs.';
  const actions = document.createElement('div'); actions.className = 'sample-download-actions';
  const choices = document.createElement('div'); choices.className = 'sample-download-choices';
  choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', 'Voices to download');
  const button = document.createElement('button'); button.type = 'button';
  actions.append(choices, button);
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  section.append(title, hint, actions, status); root.insertAdjacentElement('afterend', section);

  let busy = false;
  let scope = '';
  const excluded = new Set<string>();
  const controls = new Map<string, { checkbox: HTMLInputElement; text: HTMLSpanElement }>();

  function selection(song: CompiledSong | undefined, state: ExportState) {
    const nextScope = JSON.stringify([song?.id, song?.source.digest, state.runId]);
    if (scope !== nextScope) {
      scope = nextScope;
      excluded.clear();
      if (!busy) status.textContent = '';
    }
    const counts = new Map(song?.takes.map(take => [take.voiceId, 0]));
    for (const { take } of capturedSamples(song, state)) counts.set(take.voiceId, (counts.get(take.voiceId) ?? 0) + 1);
    const available = [...counts].filter(([, count]) => count > 0).map(([id]) => id);
    const voiceIds = available.filter(id => !excluded.has(id));
    return { counts, voiceIds, all: voiceIds.length > 0 && voiceIds.length === available.length };
  }

  function render() {
    const { song, state, source } = current();
    const { counts, voiceIds, all } = selection(song, state);
    section.hidden = !counts.size;
    const enabled = Boolean(source) && canDownload(state) && !busy;

    if (JSON.stringify([...controls.keys()]) !== JSON.stringify([...counts.keys()])) {
      controls.clear();
      choices.replaceChildren();
      for (const id of counts.keys()) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = id;
        const text = document.createElement('span');
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) excluded.delete(id);
          else excluded.add(id);
          status.textContent = '';
          render();
        });
        label.append(checkbox, text);
        choices.append(label);
        controls.set(id, { checkbox, text });
      }
    }
    for (const [id, { checkbox, text }] of controls) {
      const name = song?.parts.find(part => part.id === id)?.name ?? id;
      const count = counts.get(id) ?? 0;
      const label = `${name} · ${count} sample${count === 1 ? '' : 's'}`;
      if (text.textContent !== label) text.textContent = label;
      checkbox.checked = count > 0 && !excluded.has(id);
      checkbox.disabled = !enabled || count === 0;
    }
    const buttonLabel = all ? 'Download all samples' : 'Download selected samples';
    if (button.textContent !== buttonLabel) button.textContent = buttonLabel;
    button.disabled = !enabled || voiceIds.length === 0;
  }

  async function download() {
    const { song, state, source } = current();
    if (busy || !song || !source || !canDownload(state)) return;
    const { voiceIds, all } = selection(song, state);
    if (!voiceIds.length) return;
    busy = true;
    status.textContent = 'Preparing samples…';
    render();
    onBusyChange();
    try {
      const archive = await selectedSampleArchive(song, voiceIds, state, source);
      const now = current();
      if (now.song !== song || now.source !== source || now.state.runId !== state.runId || !canDownload(now.state))
        throw new Error('Practice session changed during download');
      const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
      const link = document.createElement('a');
      const selectionName = voiceIds.length === 1 ? sampleFileName(voiceIds[0]) : all ? 'all' : 'selected';
      link.href = url; link.download = `${sampleFileName(song.id)}-${selectionName}-samples.zip`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status.textContent = 'Samples downloaded.';
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Sample download failed'; }
    finally { busy = false; render(); onBusyChange(); }
  }
  button.addEventListener('click', () => { void download(); });
  return { render, get busy() { return busy; } };
}
