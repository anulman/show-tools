# Run the future hardware relay

The standalone relay forwards sequencer events and simulated controls. Its TypeScript server uses Node.js HTTP, HTTPS, and SSE support, with Effect Schema at input boundaries and scoped startup cleanup. It stores no audio.

The current WASM practice UI does not use this relay. `npm start` serves only the static practice files. The relay remains available for a future EliteDesk audio producer.

## Start without UI files

From the repository root, run:

```sh
npm run start:relay
```

This script supplies `--no-ui` and binds `127.0.0.1:8082`. Stop the development static server first if it uses that port. To choose another port:

```sh
node --import tsx lib/relay/server.ts --no-ui --port 8083
```

The native hardware audio producer is not implemented yet.

## Choose a bind address and TLS

Set `SHOW_TOOLS_TOKEN` before starting to reuse a chosen token. Otherwise each process generates a new token.

Use `--host` and `--port` to change the listen address. Supply both `--cert` and `--key` to serve HTTPS.

```sh
node --import tsx lib/relay/server.ts --no-ui --host 0.0.0.0 --port 8083 --cert /path/to/cert.pem --key /path/to/key.pem
```

These settings apply to future relay clients. Mobile practice only needs the generated website on an HTTPS static host.

## Publish events and controls

Send `Authorization: Bearer <token>` on API requests. The health endpoint is public. A producer also sends `X-Producer-Id` with its claimed ID.

| Request | Behavior |
| --- | --- |
| `GET /api/health` | Reports protocol version, listener count, producer connection, and UI mode |
| `POST /api/producer` | Claims the single producer lease with `{ "producerId": "..." }` |
| `DELETE /api/producer` | Releases the caller's producer lease |
| `GET /api/events` | Streams `performance` SSE events and sends the latest state on connection |
| `POST /api/events` | Accepts one versioned event from the current producer |
| `GET /api/controls` | Streams controls to the claimed producer |
| `POST /api/controls` | Submits `{ "commandId": "...", "control": { "id": "L1" } }` |

Control IDs are `L1`, `L2`, `R1`, `R2`, `pedal`, `mushroom`, and `knob`. A knob control includes a finite `value` between zero and one.

Use a unique command ID for each action. A repeated ID with the same control is a duplicate. Reusing an ID for another control returns a conflict. A 202 receipt means accepted for delivery. The producer's later `control` event reports `applied: true` or `applied: false` and any error.

Events contain `v: 1`, `runId`, increasing `seq`, `type`, and complete practice state. Types are `state`, `beat`, `control`, and `fault`. Beat events retain their source audio frame and sample rate. Receipt time is not an audio clock.

The relay rejects stale sequence numbers and retired runs. It accepts one connected producer control stream, bounds listeners and queues, and does not replay disconnected controls. See `controls.ts` for the schema and the [practice contract](../../ui/practice/CONTRACT.md) for state fields.
