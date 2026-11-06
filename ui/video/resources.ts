export class StreetResources {
  private finalizers: Array<() => void> = [];
  private closed = false;

  defer(finalize: () => void): void {
    if (this.closed) throw new Error('Street resources are disposed');
    this.finalizers.push(finalize);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const finalize of this.finalizers.reverse()) {
      try { finalize(); } catch (error) { errors.push(error); }
    }
    this.finalizers = [];
    if (errors.length) throw new AggregateError(errors, 'Street resource cleanup failed');
  }

  fail(error: unknown): never {
    try { this.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Street initialization and cleanup failed'); }
    throw error;
  }
}
