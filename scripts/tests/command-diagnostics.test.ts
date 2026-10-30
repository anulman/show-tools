import test from 'node:test';
import assert from 'node:assert/strict';
import { chiefHandoff, commandFailureExitCode, formatCommandFailure, parseCommandFailure, productFailure } from '../lib/command-diagnostics.js';

test('a blocked product operation provides machine-readable cause, source and recovery without becoming success', () => {
  const failure = productFailure({ code: 'CHART_UNKNOWN_NOTATION', message: 'Unsupported cue at J21.',
    locations: ['worksheet 101!J21'], nextSteps: ['Correct the cue or define its notation before compiling again.'] });
  assert.equal(commandFailureExitCode(failure), 2);
  assert.deepEqual(parseCommandFailure(JSON.parse(formatCommandFailure(failure, 'json'))), failure);
  assert.match(formatCommandFailure(failure, 'human'), /Blocked \[CHART_UNKNOWN_NOTATION\].*Unsupported cue/);
  assert.match(formatCommandFailure(failure, 'human'), /Location: worksheet 101!J21/);
  assert.match(formatCommandFailure(failure, 'human'), /Next steps:\n- Correct the cue/);
});

test('a harness failure requests Chief intervention with a distinct nonzero status', () => {
  const failure = chiefHandoff({ code: 'HARNESS_TOOLCHAIN_MISSING', message: 'The configured renderer compiler is unavailable.',
    locations: [], nextSteps: ['Chief: restore the toolchain or select a verified renderer, then rerun this command.'] });
  assert.equal(commandFailureExitCode(failure), 3);
  assert.equal(parseCommandFailure(JSON.parse(formatCommandFailure(failure, 'json'))).status, 'needs-chief');
  assert.match(formatCommandFailure(failure, 'human'), /Chief handoff required/);
});

test('external failure records cannot omit useful diagnostics or masquerade as success', () => {
  const valid = { schemaVersion: 1, status: 'blocked', code: 'INPUT_INVALID', message: 'Invalid input.', locations: [], nextSteps: ['Correct the input.'] };
  for (const invalid of [
    { ...valid, status: 'ok' }, { ...valid, schemaVersion: 2 }, { ...valid, code: 'not stable' },
    { ...valid, message: ' ' }, { ...valid, nextSteps: [] }, { ...valid, nextSteps: [' '] },
    { ...valid, locations: [''] },
  ]) assert.throws(() => parseCommandFailure(invalid));
});
