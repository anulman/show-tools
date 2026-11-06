import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { parseInactiveMonitor } from '../legacy-monitor.js';
import { PersistentDesk } from '../controller.js';
import { decodeSessionProfile } from '../session-profile.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';

const inactive = 'LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlGroup=\n';
const identity = { byId: '/dev/snd/by-id/usb-Focusrite_Scarlett_Solo_USB_Y7PZ8TB58373E7-00', usbSerial: 'Y7PZ8TB58373E7',
  usbVendor: '1235', usbProduct: '8211', alsaCardId: 'USB', pcmDevice: 0, monitorOff: 'Direct Monitor Playback Switch' };

test('legacy monitor status requires every exact inactive field without ambiguous duplicates', () => {
  assert.equal(parseInactiveMonitor(inactive).ActiveState, 'inactive');
  for (const value of [inactive.replace('loaded', 'not-found'), inactive.replace('inactive', 'active'), inactive.replace('dead', 'failed'),
    inactive.replace('MainPID=0', 'MainPID=12'), inactive.replace('ControlGroup=', 'ControlGroup=/unit'),
    inactive.replace('ControlGroup=\n', ''), inactive + 'ControlGroup=\n', inactive.replace('ControlGroup=\n', 'ControlGroup= \n'), '']) {
    assert.throws(() => parseInactiveMonitor(value));
  }
});

test('managed ALSA requires a complete identity instead of independent capture/playback aliases', () => {
  const profile = sessionProfile('/private/tmp/identity-profile-test');
  const driver = { kind: 'alsa', identity, captureChannels: 2, inputChannel: 0, periodFrames: 256, bufferFrames: 1024, format: 's32' };
  assert.equal(decodeSessionProfile({ ...profile, native: { ...profile.native, driver } }).native.driver.kind, 'alsa');
  assert.throws(() => decodeSessionProfile({ ...profile, native: { ...profile.native, driver: { ...driver, identity: undefined, captureDevice: 'default', playbackDevice: 'default' } } }));
  assert.throws(() => decodeSessionProfile({ ...profile, native: { ...profile.native, driver: { ...driver, requireInactiveUserService: 'another.service' } } }));
});

test('fresh ALSA enables verify the legacy service before any native spawn, and cancellation wins', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'legacy-monitor-'));
  const priorPath = process.env.PATH;
  process.env.PATH = `${directory}:${priorPath ?? ''}`;
  const status = join(directory, 'status');
  const marker = join(directory, 'native-started');
  const calls = join(directory, 'systemctl-called');
  const systemctl = join(directory, 'systemctl');
  const executable = join(directory, 'native');
  await writeFile(systemctl, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\ncat '${status}'\n`, { mode: 0o700 });
  await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\nexit 7\n`, { mode: 0o700 });
  await chmod(systemctl, 0o700); await chmod(executable, 0o700);
  const base = sessionProfile(directory);
  const profile = decodeSessionProfile({ ...base, native: { ...base.native, executable, driver: { kind: 'alsa', identity,
    requireInactiveUserService: 'scarlett-monitor.service', captureChannels: 2, inputChannel: 0, periodFrames: 256, bufferFrames: 1024, format: 's32' } } });
  const controller = new PersistentDesk(profile, installedPackage().installed);
  try {
    await writeFile(status, inactive.replace('inactive', 'active'));
    controller.setAudio('on');
    await until(() => controller.snapshot().audio.kind === 'fault' ? true : undefined);
    await assert.rejects(stat(marker));
    await writeFile(status, inactive);
    controller.setAudio('on');
    await until(() => controller.snapshot().audio.kind === 'fault' ? true : undefined);
    const argumentsSeen = (await readFile(marker, 'utf8')).trimEnd().split('\n');
    assert.deepEqual(argumentsSeen.slice(5, 7), ['hw:CARD=USB,DEV=0', 'hw:CARD=USB,DEV=0']);
    const identityIndex = argumentsSeen.indexOf('--usb-identity');
    assert.deepEqual(argumentsSeen.slice(identityIndex, identityIndex + 8), ['--usb-identity', identity.byId, identity.usbSerial,
      identity.usbVendor, identity.usbProduct, identity.alsaCardId, '0', identity.monitorOff]);
    await rm(marker);
    await writeFile(status, inactive.replace('LoadState=loaded\n', ''));
    controller.setAudio('on');
    await until(() => controller.snapshot().audio.kind === 'fault' ? true : undefined);
    await assert.rejects(stat(marker));
    assert.equal((await readFile(calls, 'utf8')).trimEnd().split('\n').length, 3, JSON.stringify(controller.snapshot().audio));
    await writeFile(systemctl, '#!/bin/sh\nhead -c 5000 /dev/zero\n');
    controller.setAudio('on');
    await until(() => controller.snapshot().audio.kind === 'fault' ? true : undefined);
    await assert.rejects(stat(marker));
    await writeFile(systemctl, '#!/bin/sh\nexec sleep 20\n');
    controller.setAudio('on');
    await until(() => controller.snapshot().audio.kind === 'fault' ? true : undefined);
    await assert.rejects(stat(marker));
    controller.setAudio('on');
    await new Promise(resolve => setTimeout(resolve, 30));
    controller.setAudio('off');
    await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
    await assert.rejects(stat(marker));
    const fake = new PersistentDesk(base, installedPackage().installed);
    try {
      fake.setAudio('on');
      await until(() => {
        const audio = fake.snapshot().audio;
        if (audio.kind === 'fault') throw new Error(audio.error);
        return audio.kind === 'ready' ? true : undefined;
      }, () => `Fake engine did not become ready: ${JSON.stringify(fake.snapshot().audio)}`);
    } finally { await fake.close(); }
  } finally {
    await controller.close();
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    await rm(directory, { recursive: true, force: true });
  }
});
