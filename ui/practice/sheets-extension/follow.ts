import { selectionFromEvent, selectionURL, type ChartSelection } from './selection.js';

function element<T extends Element>(selector: string, constructor: { new(): T }): T {
  const result = document.querySelector(selector);
  if (!(result instanceof constructor)) throw new Error(`Missing follower element ${selector}`);
  return result;
}
const targetId = Number(new URL(location.href).searchParams.get('tabId'));
const status = element('#status', HTMLParagraphElement);
const start = element('#start', HTMLButtonElement);
const stop = element('#stop', HTMLButtonElement);
const practiceURL = element('#practice-url', HTMLInputElement);
let connection: AbortController | null = null;
let sourcePort: chrome.runtime.Port | null = null;
let pending: { selection: ChartSelection; controller: AbortController } | null = null;
let applying = false;
let lastKey = '';
let runId: string | null = null;
let seq = -1;

function disconnect(message = 'Following stopped.'): void {
  connection?.abort(); connection = null;
  sourcePort?.disconnect(); sourcePort = null;
  pending = null; lastKey = ''; runId = null; seq = -1;
  start.disabled = false; stop.disabled = true; status.textContent = message;
}

async function applyPending(): Promise<void> {
  applying = true;
  let current: AbortController | undefined;
  try {
    while (pending && connection) {
      const { selection, controller } = pending;
      current = controller; pending = null;
      if (connection !== controller) continue;
      const target = await chrome.tabs.get(targetId);
      if (connection !== controller) continue;
      await chrome.tabs.update(targetId, { url: selectionURL(target.url || '', selection) });
      let selected = false;
      for (let attempt = 0; attempt < 10 && connection === controller; attempt++) {
        const results = await chrome.scripting.executeScript({ target: { tabId: targetId }, func: () => {
          const box = document.querySelector('#t-name-box');
          return box instanceof HTMLInputElement ? box.value : null;
        } });
        if (results[0]?.result === selection.range) { selected = true; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (connection !== controller) continue;
      if (!selected) throw new Error('Sheets did not confirm the column selection. Stop editing and try again.');
      status.textContent = `Following ${selection.range} directly from the practice tab.`;
    }
  } catch (error) {
    if (connection === current) disconnect(error instanceof Error ? error.message : 'Column selection failed');
  } finally { applying = false; if (pending && connection) void applyPending(); }
}

function receive(input: unknown, controller: AbortController): void {
  if (connection !== controller) return;
  const selection = selectionFromEvent(input);
  if (!selection || (runId === selection.runId && selection.seq <= seq)) return;
  runId = selection.runId; seq = selection.seq;
  const key = `${selection.spreadsheetId}/${selection.sheetId}/${selection.range}`;
  if (key === lastKey) return;
  lastKey = key; pending = { selection, controller };
  if (!applying) void applyPending();
}

element('#connect', HTMLFormElement).addEventListener('submit', async event => {
  event.preventDefault();
  disconnect('Connecting to the practice tab…');
  const controller = new AbortController();
  connection = controller;
  start.disabled = true; stop.disabled = false;
  try {
    if (!Number.isSafeInteger(targetId) || targetId < 1) throw new Error('Open this extension from the toolbar on your chart tab');
    const address = new URL(practiceURL.value);
    if (!['http:', 'https:'].includes(address.protocol)) throw new Error('Use the HTTP or HTTPS address of your practice page');
    const match = `${address.protocol}//${address.hostname}/*`;
    if (!(await chrome.permissions.contains({ origins: [match] }))) {
      if (connection !== controller) return;
      if (!(await chrome.permissions.request({ origins: [match] }))) throw new Error('Practice tab access was not granted');
    }
    if (connection !== controller) return;
    const tabs = (await chrome.tabs.query({ url: match })).filter(tab => tab.id !== targetId && tab.url && new URL(tab.url).origin === address.origin && new URL(tab.url).pathname === address.pathname);
    if (connection !== controller) return;
    const tab = tabs[0];
    if (!tab?.id) throw new Error('Open the practice page at that address first');
    if (tabs.length > 1) throw new Error('More than one practice tab has that address. Close the duplicate tabs before following.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['practice-bridge.js'] });
    if (connection !== controller) return;
    const port = chrome.tabs.connect(tab.id, { name: 'show-tools-follow' });
    sourcePort = port;
    port.onMessage.addListener(input => receive(input, controller));
    port.onDisconnect.addListener(() => { if (connection === controller) disconnect('Practice tab disconnected. Start following again after reloading it.'); });
    status.textContent = 'Connected locally. Waiting for a song position…';
  } catch (error) {
    if (connection === controller) disconnect(error instanceof Error ? error.message : 'Could not connect to the practice tab');
  }
});
stop.addEventListener('click', () => disconnect());
window.addEventListener('pagehide', () => disconnect());
