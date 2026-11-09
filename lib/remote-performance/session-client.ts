import { readFile, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { Schema } from 'effect';
import type { SessionProfile } from './session-profile.js';
import { decodeAudioDecision, decodeDeskBootstrap, DeskViewSchema, type AudioGoal, type DeskView } from './session-schema.js';
import { connectionOptions } from './connection-options.js';

const decodeView = Schema.decodeUnknownSync(DeskViewSchema);
export class DeskUnavailableError extends Error {
  constructor() { super('Cannot reach the desk. Run show-tools session start with this profile.'); }
}
export class SessionHttpError extends Error {
  constructor(readonly status: number) { super(`Desk HTTP request failed (${status}). Check the profile and private token file.`); }
}

export async function createSessionClient(profile: SessionProfile) {
  const url = new URL(profile.origin);
  if (url.origin !== profile.origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Profile origin must be a plain HTTP(S) origin without credentials, path or query.');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('A non-loopback desk requires HTTPS. Configure TLS in the profile.');
  }
  const route = connectionOptions(url, profile.connectAddress);
  const metadata = await stat(profile.tokenFile);
  if (!metadata.isFile() || metadata.size > 4096 || (metadata.mode & 0o077) !== 0 || (process.getuid && metadata.uid !== process.getuid())) {
    throw new Error('Token file must be an owner-only regular file owned by the current user (chmod 600).');
  }
  const token = (await readFile(profile.tokenFile, 'utf8')).trim();
  if (token.length < 32 || /\s/.test(token)) throw new Error('Token file must contain a bearer token of at least 32 characters without whitespace.');
  const ca = profile.tls ? await readFile(profile.tls.cert) : undefined;
  async function request(path: string, body?: unknown): Promise<unknown> {
    return await new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(new URL(path, url), {
        ...route, method: payload ? 'POST' : 'GET', ca,
        headers: { ...route.headers, authorization: `Bearer ${token}`, origin: profile.origin,
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) },
      }, res => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) { res.destroy(); reject(new Error('Desk response exceeds the size limit.')); }
          else chunks.push(chunk);
        });
        res.on('error', () => reject(new Error('Desk response interrupted.')));
        res.on('end', () => {
          if (res.statusCode !== 200) { reject(new SessionHttpError(res.statusCode ?? 0)); return; }
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { reject(new Error('Desk returned invalid JSON.')); }
        });
      });
      const timeout = setTimeout(() => req.destroy(new Error('timeout')), 3000);
      req.once('close', () => clearTimeout(timeout));
      req.on('error', error => reject('code' in error && error.code === 'ECONNREFUSED' ? new DeskUnavailableError() : new Error('Desk connection failed. Check the named service, profile and TLS configuration.')));
      req.end(payload);
    });
  }
  const status = async () => decodeView(await request('/api/status'));
  async function wait(goal: AudioGoal, timeoutMs = 30_000): Promise<DeskView> {
    const deadline = Date.now() + timeoutMs;
    do {
      const view = await status();
      if ((goal === 'on' && view.audio.kind === 'ready') || (goal === 'off' && view.audio.kind === 'off')) return view;
      if (view.audio.kind === 'fault') throw new Error(`Audio fault: ${view.audio.error}`);
      await delay(100);
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for audio ${goal}. Check session status and the named user service journal.`);
  }
  return {
    status,
    audio: async (goal: AudioGoal) => {
      const bootstrap = decodeDeskBootstrap(await request('/api/session'));
      const decision = decodeAudioDecision(await request('/api/audio', { sessionId: bootstrap.sessionId, sequence: 1, goal }));
      if (decision.outcome === 'rejected') throw new Error(`Audio request rejected: ${decision.error}`);
      return await wait(goal);
    },
  };
}
export type SessionClient = Awaited<ReturnType<typeof createSessionClient>>;
