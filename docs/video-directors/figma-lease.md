# Guard a director's Figma calls

The shared file lease is a cooperative harness protocol. MCP does not enforce ownership or page permissions. This wrapper prevents a failed acquisition or changed owner from reaching the Figma tool through that wrapper. It does not prevent another process from bypassing it or changing ownership between the check and the remote call.

## Prepare one owned batch

1. Follow the [shared acquisition procedure](README.md#keep-figma-calls-sequential). Require the actual completed acquisition result with `exit_code: 0`. Do not turn a busy, missing, failed, or pending result into success.
2. After successful acquisition, write the complete JSON owner record with a fresh token and retain an identical local copy. Never write an owner record after a failed acquisition. Do not reuse tokens across batches.
3. Save the actual acquisition result as `acquire-result.json` and the expected owner record as `lease-owner.json` in your working directory.
4. Generate the wrapper from the repository helper. Use the actual file key and your saved records.

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { ownedFigmaCallerCode } from './scripts/video-expansion/owned-figma.js';

const acquisition: unknown = JSON.parse(await readFile('acquire-result.json', 'utf8'));
const owner: unknown = JSON.parse(await readFile('lease-owner.json', 'utf8'));
const code = ownedFigmaCallerCode({ fileKey, owner, acquisition });
await writeFile('owned-call.js', code, { flag: 'wx' });
```

The generator refuses unsuccessful or incomplete acquisition results. Each generated wrapper captures the complete expected owner record. It checks the live JSON record, including metadata, without consulting a mutable local receipt. It rejects symlinked lease directories or owner files. It never acquires, deletes, or releases a lease itself.

## Make a guarded call

Load the applicable Figma skills first. Evaluate the complete generated `owned-call.js` text in `functions.exec`, then call `await callOwnedFigma(args)` in that same execution context. Pass the normal `use_figma` arguments, including the current session ID. Keep that one wrapper instance for the batch; do not create parallel copies to evade its sequential-call check.

The wrapper requires `description` to be a string, matching the connector's input schema. Missing or non-string descriptions make no lease-check or Figma call and do not hold the wrapper. Empty strings satisfy this type check.

The wrapper rejects scripts whose complete transmitted code, including its injected file guard, exceeds the connector’s 50,000-character limit. It counts JavaScript string units conservatively. Compact or split the authorized work before calling; do not truncate verification code. A local size rejection makes no tool call and does not create an uncertain-operation hold.

The wrapper verifies the requested file key, then requires a completed successful live-owner check immediately before calling `use_figma`. It prepends a live `figma.fileKey` assertion before the caller's code. A lost owner, failed check, or wrong target makes no Figma call. Restrict the caller's code to its authorized page and nodes. The wrapper does not inspect script semantics or grant new mutation authority.

Inspect every tool response. A thrown transport error, missing response, or returned `isError: true` keeps that wrapper held. Return to Chief to establish whether the call finished and what changed. A saved connector input-schema rejection establishes that the script was not dispatched. Chief can clear that hold for the same bounded batch after confirming the exact live owner, then authorize a corrected request. This does not waive any product or artwork check. Do not recreate the wrapper, repeat the mutation, or release the lease to bypass an unresolved call. Hold only the dependent batch and continue independent work.

After completed calls, verify the exact owner record before releasing. Never remove another session's lease. If acquisition was busy, do not release anything.

## Recover a response-size rejection

The connector's observed return-value limit is 48,000 bytes. This is separate from its 50,000-character input-code limit. The wrapper's input preflight cannot predict exported images or the size of a computed result.

For bulk verification, request small, explicit groups of node IDs and return compact metadata. Aim for at most 24,000 UTF-8 bytes of JSON per group to leave headroom. Keep exported image bytes in the tool's artifact outputs rather than embedding base64 in the JSON return. Record requested IDs and verify that the returned IDs and artifacts cover that exact group. A partial image set is incomplete verification. Do not truncate receipts or omit required source, pixel, or framing checks to fit a response.

A return-size error occurs after the script has run. Preserve its complete error, debug UUID, exact executed script, and current owner record. The wrapper remains held until Chief reconciles that evidence. Do not infer non-execution from a response-size rejection.

In the Tribulations read-only verification incident, the connector explicitly reported `safeToRetryWithoutCanvasRead: true` and that canvas edits were not committed. After confirming the exact live owner, Chief cleared only that same bounded read batch for smaller groups. This recovery did not authorize reimporting sources or replaying mutations. For a mutation or uncertain response, establish actual canvas state and the connector's explicit disposition before deciding whether to retry. An error message alone does not waive product checks.

After a cleared read batch, regenerate the guarded caller under the still-matching lease and export smaller groups. If ownership changed, stop and reacquire through the normal protocol. Send a repeated or ambiguous failure to Chief instead of retrying the entire batch or interrupting the operator.

## Verify without touching the shared file

Run the regression tests from your checkout:

```sh
node --import tsx --test scripts/tests/owned-figma.test.ts
npm run typecheck
```

Tests execute the generated wrapper with controlled tool callbacks and run its actual shell check against an isolated, uniquely named temporary lease. They cover busy acquisition, missing results, ownership loss, wrong files, overlap, shell quoting, complete payload-size boundaries, and uncertain tool failures. They make no live Figma calls and do not inspect or alter the production lease.
