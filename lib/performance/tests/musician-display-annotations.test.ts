import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { instrumentCue, isMusicianVocalCue, parseMusicianFill, sectionFeelSummary } from '../musician-annotations.js';
import { readMusicXmlSong } from '../musicxml-song.js';

test('exact fills space attacks and retain phrase boundaries without inventing duration', () => {
  assert.deepEqual(parseMusicianFill('4e&a]'), { kind: 'exact', counts: '4e&a', bracket: 'end', leadingDash: false, display: 'Fill: 4 e & a]' });
  assert.deepEqual(parseMusicianFill('[-4e&a]'), { kind: 'exact', counts: '4e&a', bracket: 'both', leadingDash: true, display: '[Fill: 4 e & a]' });
  assert.equal(parseMusicianFill('3e&a4e&a')?.display, 'Fill: 3 e & a 4 e & a');
});

test('single accented counts indicate freeform fills from that count', () => {
  for (const [text, display, fromCount, bracket, leadingDash] of [
    ['[3!', '[Fill from 3', 3, 'start', false], ['1!]', 'Fill from 1]', 1, 'end', false],
    ['-2!', 'Fill from 2', 2, 'none', true], ['-4!', 'Fill from 4', 4, 'none', true],
  ] satisfies Array<[string, string, number, string, boolean]>) {
    assert.deepEqual(parseMusicianFill(text), { kind: 'freeform', fromCount, bracket, leadingDash, display });
  }
});

test('unknown compounds, malformed fills and whole-cell feels retain literal notation', () => {
  for (const text of ['!', '!!', '!!!', '!4!!', '!2!!', '[3! 1!]', '4!!', '4! 1!', '4a&e', '4e&a3&', '4e&a3e&a', '3e&a3e&a', '1&2&3&4&', '1 2 3 4', '1p&p2p', '3&4e&a', '--4!', '[[3!', '4e&a]]', '4', 'fill', "4e&a'"]) {
    assert.equal(parseMusicianFill(text), null, text);
  }
});

test('only whole vocal annotation marks disappear; lyrics and accented ampersands survive', () => {
  for (const text of ['-', "-'", '-′', '-’', '-ʼ', '-ʹ', ' -′ ']) assert.equal(isMusicianVocalCue({ text }), false, text);
  for (const text of ['&', '3&', '3 &', 'hey!', '!', '!!', '—', 'show', 'put your little feet', 'day - night', "don't", "-' lyric"]) {
    assert.equal(isMusicianVocalCue({ text }), true, text);
  }
});

test('canonical DYC displays are formatted without changing report data', async () => {
  const document = await readMusicXmlSong(await readFile(new URL('../../../songs/dance-yrself-clean.musicxml', import.meta.url), 'utf8'));
  const before = JSON.stringify(document);
  const expected = new Map([['4e&a]', 'Fill: 4 e & a]'], ['[3!', '[Fill from 3'], ['1!]', 'Fill from 1]'], ['!4!!', '!4!!'], ['!2!!', '!2!!']]);
  for (const [text, display] of expected) {
    const annotation = document.report.annotations.instrumentDisplays.find(annotation => annotation.text === text);
    assert.ok(annotation, `Real chart contains ${text}`);
    assert.equal(instrumentCue(annotation.cell, document.report), display);
  }
  assert.equal(JSON.stringify(document), before);
});

test('feel summaries use singular bar for a one-bar range and retain whole-section feels', () => {
  const section = { id: 'section', label: 'Section', startBar: 1, endBar: 8 };
  assert.equal(sectionFeelSummary(section, [{ startBar: 3, endBar: 3, text: 'Funky' }]), 'Funky, bar 3');
  assert.equal(sectionFeelSummary(section, [{ startBar: 3, endBar: 4, text: 'Extra funky' }]), 'Extra funky, bars 3-4');
  assert.equal(sectionFeelSummary(section, [{ startBar: 1, endBar: 8, text: 'Funky' }]), 'Funky');
});
