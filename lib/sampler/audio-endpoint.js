export class AudioEndpoint {
  constructor(port, { pollInterval = 50, requestTimeout = 5000 } = {}) {
    if (!port || typeof port.postMessage !== 'function') throw new Error('A MessagePort is required');
    if (!Number.isFinite(pollInterval) || pollInterval < 0) throw new Error('Invalid poll interval');
    if (!Number.isFinite(requestTimeout) || requestTimeout <= 0) throw new Error('Invalid request timeout');
    this.port = port;
    this.pending = new Map();
    this.listeners = new Set();
    this.latest = null;
    this.nextId = 0;
    this.disposed = false;
    this.pollPending = false;
    this.requestTimeout = requestTimeout;
    this.receive = ({ data }) => {
      if (this.disposed || !data || typeof data !== 'object') return;
      if (data.state) {
        this.latest = data.state;
        for (const listener of this.listeners) {
          try { listener(this.latest); } catch (error) { globalThis.reportError?.(error); }
        }
      }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      clearTimeout(pending.timeout);
      if (data.ok) pending.resolve(data.value === undefined ? data.state : data.value);
      else pending.reject(new Error(data.error || 'Audio command failed'));
    };
    this.onMessageError = () => this.dispose(new Error('Audio message could not be read'));
    port.onmessage = this.receive;
    port.onmessageerror = this.onMessageError;
    port.start?.();
    if (pollInterval > 0) this.pollTimer = setInterval(() => this.poll(), pollInterval);
  }

  request(command, payload = {}, transfer = []) {
    if (this.disposed) return Promise.reject(new Error('Audio endpoint disposed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Audio command timed out. Resume audio and try again.'));
      }, this.requestTimeout);
      this.pending.set(id, { resolve, reject, timeout });
      try { this.port.postMessage({ id, command, payload }, transfer); }
      catch (error) { clearTimeout(timeout); this.pending.delete(id); reject(error); }
    });
  }

  poll() {
    if (this.disposed || this.pollPending) return;
    this.pollPending = true;
    this.request('state').catch(() => {}).finally(() => { this.pollPending = false; });
  }

  snapshot() { return this.latest; }

  subscribe(listener) {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return () => this.listeners.delete(listener);
  }

  dispose(error = new Error('Audio endpoint disposed')) {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.pollTimer);
    this.pollPending = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.listeners.clear();
    this.port.onmessage = null;
    this.port.onmessageerror = null;
    this.port.close?.();
  }
}
