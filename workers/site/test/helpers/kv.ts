// In-memory stand-ins for Workers bindings, shared by the tests.

export interface MemoryKvPut {
  key: string;
  value: string;
  expirationTtl?: number;
}

// Minimal KVNamespace: get (text or json), put, delete. Expiration is recorded but NOT enforced, so tests can
// prove that the SEO cache honours its own "expires" field. `failGet` / `failPut` make every call reject.
export class MemoryKV {
  readonly store = new Map<string, string>();
  readonly puts: MemoryKvPut[] = [];
  readonly gets: string[] = [];
  failGet = false;
  failPut = false;

  async get(key: string, options?: unknown): Promise<unknown> {
    this.gets.push(key);
    if (this.failGet) throw new Error('KV get failed (test)');
    const value = this.store.get(key);
    if (value === undefined) return null;
    const type = typeof options === 'string' ? options : (options as { type?: string } | undefined)?.type;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    if (this.failPut) throw new Error('KV put failed (test)');
    this.puts.push({ key, value, expirationTtl: options?.expirationTtl });
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  asBinding(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}

// ExecutionContext whose waitUntil promises can be awaited by the test.
export class TestContext {
  readonly pending: Promise<unknown>[] = [];

  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(promise);
  }

  passThroughOnException(): void {}

  async settle(): Promise<void> {
    await Promise.allSettled(this.pending.splice(0));
  }

  asContext(): ExecutionContext {
    return this as unknown as ExecutionContext;
  }
}
