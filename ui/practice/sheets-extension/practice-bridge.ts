export {};
declare global { interface Window { showToolsBridgeInstalled?: boolean } }

if (!window.showToolsBridgeInstalled) {
  window.showToolsBridgeInstalled = true;
  const ports = new Set<chrome.runtime.Port>();
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'show-tools-follow') return;
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    window.postMessage({ kind: 'show-tools-state-request' }, location.origin);
  });
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin || typeof event.data !== 'object' || !event.data || !('kind' in event.data) ||
      event.data.kind !== 'show-tools-performance' || !('event' in event.data)) return;
    for (const port of ports) {
      try { port.postMessage(event.data.event); }
      catch { ports.delete(port); }
    }
  });
}
