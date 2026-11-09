import { Schema } from 'effect';
import type { RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';

export const ConnectAddressSchema = Schema.String.check(
  Schema.makeFilter(value => isIP(value) !== 0 || 'Connection address must be a literal IP address'),
).pipe(Schema.brand('DeskConnectAddress'));
export type ConnectAddress = typeof ConnectAddressSchema.Type;

export function connectionOptions(origin: URL, connectAddress?: ConnectAddress): RequestOptions {
  if (connectAddress === undefined) return {};
  if (origin.protocol === 'http:') {
    const loopback = isIP(connectAddress) === 4 ? connectAddress.startsWith('127.')
      : !connectAddress.includes('%') && new URL(`http://[${connectAddress}]/`).hostname === '[::1]';
    if (!loopback) throw new Error('An HTTP connection address must be loopback');
  }
  const route = { hostname: connectAddress, headers: { host: origin.host } };
  if (origin.protocol !== 'https:') return route;
  const hostname = origin.hostname.startsWith('[') ? origin.hostname.slice(1, -1) : origin.hostname;
  // A shared destination must not reuse a TLS session authenticated for another original IP.
  return { ...route, agent: false, servername: isIP(hostname) === 0 ? hostname : '',
    checkServerIdentity: (_hostname: string, certificate: PeerCertificate) => checkServerIdentity(hostname, certificate) };
}
