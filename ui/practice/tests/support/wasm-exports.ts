export function withoutPerformanceExports(bytes: Uint8Array): Uint8Array {
  let cursor = 8;
  function read() {
    let value = 0, shift = 0, byte: number;
    do { byte = bytes[cursor++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128);
    return value;
  }
  const encode = (value: number) => {
    const result: number[] = [];
    do { const next = value & 127; value >>>= 7; result.push(next | (value ? 128 : 0)); } while (value);
    return result;
  };
  const output = Array.from(bytes.subarray(0, 8));
  const decoder = new TextDecoder();
  const append = (values: Iterable<number>) => { for (const value of values) output.push(value); };
  while (cursor < bytes.length) {
    const sectionStart = cursor;
    const kind = bytes[cursor++];
    const length = read();
    const end = cursor + length;
    if (kind !== 7) { append(bytes.subarray(sectionStart, end)); cursor = end; continue; }
    const entries: number[][] = [];
    const count = read();
    for (let index = 0; index < count; index++) {
      const start = cursor;
      const nameLength = read();
      const name = decoder.decode(bytes.subarray(cursor, cursor + nameLength));
      cursor += nameLength + 1;
      read();
      if (!name.startsWith('pf_') && !name.startsWith('sq_')) entries.push(Array.from(bytes.subarray(start, cursor)));
    }
    const body = [...encode(entries.length), ...entries.flat()];
    output.push(7); append(encode(body.length)); append(body);
  }
  return Uint8Array.from(output);
}
