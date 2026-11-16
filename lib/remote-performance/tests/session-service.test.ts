import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSessionService, renderSessionUnit } from '../session-service.js';
import { sessionProfile } from './session-fixture.js';

test('Restart=no preserves the installed unit layout and passes strict service verification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'session-no-restart-'));
  const profile = { ...sessionProfile(directory), restartPolicy: 'no' } satisfies ReturnType<typeof sessionProfile>;
  const profilePath = join(directory, 'session.json');
  const unitDirectory = join(directory, 'systemd/user');
  const unitPath = join(unitDirectory, profile.serviceName);
  const installed = `# Managed by show-tools session install. Do not edit this unit.\n[Unit]\nDescription=Show Tools performance desk\n\n[Service]\nType=exec\nExecStart="${profile.server.nodeExecutable}" "${profile.server.entrypoint}" --profile "${profilePath}"\nRestart=no\nKillMode=control-group\nTimeoutStopSec=15s\nSendSIGKILL=yes\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
  const actions: string[] = [];
  try {
    assert.equal(renderSessionUnit(profile, profilePath), installed);
    await mkdir(unitDirectory, { recursive: true });
    await writeFile(unitPath, installed, { mode: 0o600 });
    const service = createSessionService(profile, profilePath, { configDirectory: directory, run: async (executable, args) => {
      assert.equal(executable, 'systemctl');
      actions.push(args[1] ?? '');
      return { code: 0, stdout: args[1] === 'show' ? `LoadState=loaded\nActiveState=inactive\nMainPID=0\nTasksCurrent=0\nFragmentPath=${unitPath}\nDropInPaths=\n` : '' };
    } });
    await service.stop();
    assert.deepEqual(actions, ['show', 'stop', 'show']);
    const retry = renderSessionUnit({ ...profile, restartPolicy: 'on-failure' }, profilePath);
    assert.match(retry, /StartLimitIntervalSec=0\n/);
    assert.match(retry, /Restart=on-failure\nRestartSec=3s\n/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
