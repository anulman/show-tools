export function scoreXmlText(text: string): string {
  for (const symbol of text) {
    const code = symbol.codePointAt(0) ?? 0;
    if (!(code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0xd7ff
      || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff)) {
      throw new Error(`XML 1.0 cannot represent character U+${code.toString(16).toUpperCase()}.`);
    }
  }
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('\r', '&#13;');
}
