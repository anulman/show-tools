import { Schema } from 'effect';

const Acquisition = Schema.Struct({ exit_code: Schema.Literal(0) });
const Identity = Schema.Struct({ threadId: Schema.NonEmptyString, token: Schema.NonEmptyString });
const Input = Schema.Struct({
  fileKey: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9]+$/)),
  owner: Schema.Record(Schema.String, Schema.Unknown),
  acquisition: Acquisition,
});
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Generate a functions.exec wrapper after a completed, successful lease acquisition. */
export function ownedFigmaCallerCode(input: unknown): string {
  const { fileKey, owner } = Schema.decodeUnknownSync(Input)(input);
  Schema.decodeUnknownSync(Identity)(owner);
  const lease = `/private/tmp/show-tools-figma-${fileKey}.lease`;
  const check = `import { readFileSync, lstatSync } from 'node:fs';
import { deepStrictEqual, ok } from 'node:assert/strict';
ok(lstatSync(${JSON.stringify(lease)}).isDirectory(), 'Lease must be a directory');
ok(lstatSync(${JSON.stringify(lease + '/owner')}).isFile(), 'Lease owner must be a regular file');
deepStrictEqual(JSON.parse(readFileSync(${JSON.stringify(lease + '/owner')}, 'utf8')), ${JSON.stringify(owner)});
`;
  const command = 'node --input-type=module -e ' + shellQuote(check);
  return `const callOwnedFigma = (() => {
  let pending = false;
  return async function callOwnedFigma(args) {
    if (pending) throw Error('Figma harness needs Chief: prior call is active or unresolved');
    if (!args || args.fileKey !== ${JSON.stringify(fileKey)} || typeof args.code !== 'string')
      throw Error('Figma harness needs Chief: wrong file or missing code');
    pending = true;
    let requested = false;
    try {
      const check = await tools.exec_command({cmd: ${JSON.stringify(command)}, max_output_tokens: 200});
      if (check?.exit_code !== 0)
        throw Error('Figma harness needs Chief: live lease ownership was not verified; no file call made');
      requested = true;
      const response = await tools.mcp__codex_apps__figma_use_figma({
        ...args,
        code: ${JSON.stringify(`if(figma.fileKey!==${JSON.stringify(fileKey)})throw Error('Figma harness needs Chief: wrong live file');\n`)} + args.code,
      });
      if (response && response.isError !== true) pending = false;
      return response;
    } catch (error) {
      if (!requested) pending = false;
      throw error;
    }
  };
})();`;
}
