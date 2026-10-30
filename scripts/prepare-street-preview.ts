import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { compileSong } from '../lib/performance/compiled-song.js';
import { parseSongSource } from '../lib/performance/song-source.js';
import { parseCatalogDocument } from '../lib/voice-catalog/model.js';
import { discoverSheetVoices } from '../lib/voice-catalog/sheet-voices.js';
import { resolveVoice } from '../lib/voice-catalog/session.js';
import { compileStreetScore, StreetScene, type StreetWindow } from '../lib/video/street-score.js';
import { deriveMainVocalSections } from '../lib/video/main-vocal-sections.js';
import { Schema } from 'effect';

const [catalogPath, sourcePath, mappingPath, assetsScenePath, outputPath] = process.argv.slice(2);
if (!catalogPath || !sourcePath || !mappingPath || !assetsScenePath || !outputPath) throw new Error('Usage: prepare-street-preview.ts catalog.json source.json mapping.json assets-scene.json output.json (keep operator inputs/output private)');
const files = await Promise.all([catalogPath, sourcePath, mappingPath, assetsScenePath].map(path => readFile(path, 'utf8')));
const [catalogText, sourceText, mappingText, assetsText] = files;
const catalog = parseCatalogDocument(JSON.parse(catalogText)), source = parseSongSource(JSON.parse(sourceText));
const compiled = await compileSong(source, JSON.parse(mappingText));
const mainVocalSections = deriveMainVocalSections({ compiled, source });
const countedBeatUnit = compiled.meter.denominator;
if (countedBeatUnit !== 4 && countedBeatUnit !== 8) throw new Error('Street preview supports quarter-note or eighth-note counts');
const previewCountsPerSecond = compiled.chart.bpm / 60;
const assets = Schema.decodeUnknownSync(StreetScene)(JSON.parse(assetsText));
const resolved = discoverSheetVoices(compiled, source).map(row => {
  const voice = resolveVoice(catalog, row);
  if (!voice?.characterId) throw new Error(`No saved character for ${row.labelCell}`);
  const part = compiled.parts.find(part => part.id === row.partId);
  const role = part?.role.kind === 'default-live' ? 'main-vocals' : part?.role.kind === 'rotation-live' ? 'backup-vocals' : 'instrument';
  return { row, voice, role };
});
if (resolved.length !== assets.actors.length || new Set(resolved.map(item => item.voice.characterId)).size !== resolved.length) throw new Error('Saved cast and supplied Street asset placements must match exactly');
const actors = assets.actors.map(actor => {
  const binding = resolved.find(item => item.voice.characterId === actor.characterId);
  if (!binding) throw new Error(`Street actor ${actor.characterId} is outside saved cast`);
  return { ...actor, role: binding.role };
});
const durationCounts = 32;
const boundaries = [0, 4, 8, 12, 16, 20, 24, 28, 32];
const windows = actors.map((actor, index) => ({ actor: index, states: boundaries.slice(0, -1).map((start, i): StreetWindow => ({
  start, end: boundaries[i + 1],
  active: actor.role === 'backup-vocals' ? [8, 20, 24].includes(start) : start >= 4 && start < 28,
  emphasis: start === 12 || start === 20 ? 'special' : start === 16 || start === 24 ? 'ultra' : 'normal',
  source: start === 8 ? 'sampled' : 'live', specialIndex: 0, ultraIndex: 0,
})) }));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const authored = { windows: windows.map(track => ({ ...track, accents: Array.from({ length: durationCounts * 4 }, (_, i) => i / 4), downbeats: boundaries.slice(0, -1) })) };
const scene = compileStreetScore({ scene: { ...assets, actors, durationCounts, previewCountsPerSecond, countedBeatUnit,
  provenance: { source: 'explicit-policy-demonstration; art cast resolved from saved library; native loaded program unverified', assetsDigest: digest(assetsText), scoreDigest: digest(JSON.stringify(authored)) },
}, ...authored });
const preparedText = `${JSON.stringify(scene, null, 2)}\n`;
await writeFile(outputPath, preparedText);
await writeFile(`${outputPath}.receipt.json`, `${JSON.stringify({ kind: 'private-authored-preview-receipt', catalogSha256: digest(catalogText), sourceSha256: digest(sourceText), mappingSha256: digest(mappingText), assetsSha256: digest(assetsText), preparedSha256: digest(preparedText), sourceDigest: compiled.source.digest, mainVocalSections, savedBindings: resolved.map(({ row, voice }) => ({ spreadsheetId: row.spreadsheetId, sheetId: row.sheetId, labelCell: row.labelCell, sourceLabel: row.sourceLabel, voiceId: voice.id, characterId: voice.characterId })), nativeProgram: 'not-verified' }, null, 2)}\n`);
process.stdout.write(`Prepared ${actors.length} actors; ${(durationCounts / previewCountsPerSecond).toFixed(3)}s authored policy preview at ${compiled.chart.bpm} counted BPM. Private receipt: ${outputPath}.receipt.json\n`);
