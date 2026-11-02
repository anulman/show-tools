import { Schema } from 'effect';

const NodeFiles = Schema.Struct({ readFile: Schema.declare((value): value is (url: URL, encoding: 'utf8') => Promise<string> => typeof value === 'function') });

export async function readBundledMusicXml(id: string): Promise<string> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid bundled song identity.');
  const source = new URL(`./${id}.musicxml`, import.meta.url);
  if (source.protocol === 'file:') {
    const moduleName = 'node:fs/promises';
    const module: unknown = await import(moduleName);
    return Schema.decodeUnknownSync(NodeFiles)(module).readFile(source, 'utf8');
  }
  const response = await fetch(new URL(`/ui/practice/songs/${id}.musicxml`, source));
  if (!response.ok) throw new Error(`Cannot load ${id} MusicXML (${response.status}).`);
  return response.text();
}
