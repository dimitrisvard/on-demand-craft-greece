// Durable Object fakes for T1: FakeDurableObjectState with the ctx.storage subset the agent classes use
// (storage.sql.exec over node:sqlite DatabaseSync, get/put/delete/list, transactionSync,
// setAlarm/getAlarm/deleteAlarm, blockConcurrencyWhile, id.name) and a namespace fake that returns one instance per
// name (idFromName + get).
// sql.exec rules as the runtime: '?' bindings; booleans are bound as 1/0 and undefined as NULL; a query string with
// several statements and no bindings runs them all and returns no rows; one() throws unless exactly one row.

import { DatabaseSync } from 'node:sqlite';

export interface FakeSqlCursor<T> {
  toArray(): T[];
  one(): T;
  readonly rowsWritten: number;
  [Symbol.iterator](): Iterator<T>;
}

type SqlValue = null | number | bigint | string | Uint8Array;

function bindable(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  throw new Error(`FakeDurableObjectState: cannot bind ${typeof v}`);
}

/** True when the text holds more than one statement (a ';' followed by more SQL outside string literals). */
function multiStatement(query: string): boolean {
  let inString = false;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (ch === "'") inString = !inString;
    else if (ch === ';' && !inString && query.slice(i + 1).trim() !== '') return true;
  }
  return false;
}

function cursor<T>(rows: T[], rowsWritten: number): FakeSqlCursor<T> {
  return {
    toArray: () => rows,
    one: () => {
      if (rows.length !== 1) throw new Error(`Expected exactly one result from SQL query, but got ${rows.length}.`);
      return rows[0];
    },
    rowsWritten,
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  };
}

export class FakeDurableObjectState {
  readonly id: { name: string; toString(): string; equals(other: { toString(): string }): boolean };
  readonly storage: {
    sql: { exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): FakeSqlCursor<T> };
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    list<T = unknown>(o?: { prefix?: string }): Promise<Map<string, T>>;
    transactionSync<T>(fn: () => T): T;
    setAlarm(scheduledTime: number | Date): Promise<void>;
    getAlarm(): Promise<number | null>;
    deleteAlarm(): Promise<void>;
  };
  /** The object built on this state (set by fakeNamespace); runAlarm() calls its alarm(). */
  owner?: { alarm?: () => Promise<void> };
  readonly db: DatabaseSync;
  private alarmAt: number | null = null;
  private readonly kv = new Map<string, unknown>();

  constructor(name: string) {
    const db = new DatabaseSync(':memory:');
    this.db = db;
    this.id = { name, toString: () => `fake-do-${name}`, equals: (o) => o.toString() === `fake-do-${name}` };
    const kv = this.kv;
    this.storage = {
      sql: {
        exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): FakeSqlCursor<T> {
          if (bindings.length === 0 && multiStatement(query)) {
            db.exec(query);
            return cursor<T>([], 0);
          }
          const statement = db.prepare(query);
          const rows = statement.all(...bindings.map(bindable)).map((r) => ({ ...(r as Record<string, unknown>) }) as T);
          const changes = Number((db.prepare('SELECT changes() AS c').get() as { c: number }).c);
          const writes = /^\s*(insert|update|delete|replace)/i.test(query) ? changes : 0;
          return cursor<T>(rows, writes);
        },
      },
      get: async <T>(key: string) => (kv.has(key) ? (structuredClone(kv.get(key)) as T) : undefined),
      put: async (key: string, value: unknown) => {
        kv.set(key, structuredClone(value));
      },
      delete: async (key: string) => kv.delete(key),
      list: async <T>(o?: { prefix?: string }) => new Map([...kv.entries()].filter(([k]) => !o?.prefix || k.startsWith(o.prefix)).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, T]>),
      transactionSync: <T>(fn: () => T): T => {
        db.exec('SAVEPOINT tx');
        try {
          const result = fn();
          db.exec('RELEASE tx');
          return result;
        } catch (e) {
          db.exec('ROLLBACK TO tx');
          db.exec('RELEASE tx');
          throw e;
        }
      },
      setAlarm: async (t: number | Date) => {
        this.alarmAt = typeof t === 'number' ? t : t.getTime();
      },
      getAlarm: async () => this.alarmAt,
      deleteAlarm: async () => {
        this.alarmAt = null;
      },
    };
  }

  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  /** Runs the scheduled alarm of the object, if any (the test drives time). */
  async runAlarm(): Promise<void> {
    if (this.alarmAt === null) return;
    this.alarmAt = null;
    await this.owner?.alarm?.();
  }
}

/** A DurableObjectNamespace fake: one instance of the class per name, created with a FakeDurableObjectState. */
export function fakeNamespace<T>(create: (state: FakeDurableObjectState) => T): DurableObjectNamespace & { instance(name: string): T; state(name: string): FakeDurableObjectState } {
  const instances = new Map<string, { object: T; state: FakeDurableObjectState }>();
  const ensure = (name: string) => {
    let entry = instances.get(name);
    if (!entry) {
      const state = new FakeDurableObjectState(name);
      const object = create(state);
      state.owner = object as unknown as { alarm?: () => Promise<void> };
      entry = { object, state };
      instances.set(name, entry);
    }
    return entry;
  };
  const idFromName = (name: string) => ({ name, toString: () => `fake-do-${name}`, equals: (o: { toString(): string }) => o.toString() === `fake-do-${name}` });
  const namespace = {
    idFromName,
    idFromString: (id: string) => idFromName(id.replace(/^fake-do-/, '')),
    newUniqueId: () => idFromName(crypto.randomUUID()),
    get: (id: { name?: string; toString(): string }) => ensure(id.name ?? id.toString().replace(/^fake-do-/, '')).object,
    getByName: (name: string) => ensure(name).object,
    jurisdiction: () => namespace,
    instance: (name: string) => ensure(name).object,
    state: (name: string) => ensure(name).state,
  };
  return namespace as unknown as DurableObjectNamespace & { instance(name: string): T; state(name: string): FakeDurableObjectState };
}
