export type StreetCell = {
  readonly active: boolean;
  readonly emphasis: 'normal' | 'special' | 'ultra';
  readonly sampled: boolean;
  readonly accents: readonly number[];
  readonly anchor: number | null;
};

/** Forward subdivision notation; grouping marks annotate phrases, never audio stops. */
export function parseStreetCell(text: string, beatsPerBar: number, lyric = false): StreetCell {
  const value = text.trim();
  const emphasis = value.includes('!!') ? 'ultra' : value.includes('!') ? 'special' : 'normal';
  const result = { active: value !== '', emphasis, sampled: value.includes("'"), accents: [], anchor: null } satisfies StreetCell;
  const words = /^([1-9])?([A-Za-z][A-Za-z\s'’"“”.,!?…:;()/-]*)$/.exec(value);
  if (lyric && words && !/^[ea]$/i.test(value)) {
    const beat = words[1] === undefined ? null : Number(words[1]);
    if (beat !== null && beat > beatsPerBar) throw new Error('Overflowing lyric pickup');
    return { ...result, accents: beat === null ? [] : [beat - 1], anchor: beat === null ? null : beat - 1 };
  }
  const accents: number[] = [];
  let position = -1;
  let anchor: number | null = null;
  const tokens = value.match(/\([1-9]\d*\)|[1-9]|[e&a]|[-'!\s\[\]]|./g) ?? [];
  for (const token of tokens) {
    if (/^[-'!\s\[\]]$/.test(token)) continue;
    const silent = token.startsWith('(');
    const number = silent ? Number(token.slice(1, -1)) : /^[1-9]$/.test(token) ? Number(token) : null;
    let next: number;
    if (number !== null) next = (number - 1) * 4;
    else if (token === 'e' || token === '&' || token === 'a') {
      const subdivision = token === 'e' ? 1 : token === '&' ? 2 : 3;
      next = Math.floor(Math.max(0, position) / 4) * 4 + subdivision;
      if (next <= position) next += 4;
    } else throw new Error(`Unsupported Street notation ${JSON.stringify(token)}`);
    if (next <= position || next >= beatsPerBar * 4) throw new Error(`Backward or overflowing Street accent ${token}`);
    if (anchor === null) anchor = number === null ? 0 : number - 1;
    position = next;
    if (!silent) accents.push(next / 4);
  }
  return { ...result, accents, anchor };
}
