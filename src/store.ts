// Counter storage on Node's built-in SQLite (node:sqlite, Node >= 24; ADR-000 + the COLD-2 design).
// Every statement is prepared and parameterised: a counter name never reaches SQL text. A duplicate
// create is detected by the PRIMARY KEY constraint (one statement), never by a read-then-write.
import { DatabaseSync } from 'node:sqlite';

export interface Counter {
  name: string;
  value: number;
}

export interface CounterStore {
  /** Create `name` at 0. Throws CounterExistsError if it already exists (the value is untouched). */
  create(name: string): Counter;
  /** The counter, or undefined when no counter has that name. */
  get(name: string): Counter | undefined;
  /** Add `by` (>= 1) atomically. Throws CounterNotFoundError, or CounterBoundError past MAX_VALUE. */
  increment(name: string, by: number): Counter;
  /** Subtract `by` (>= 1) atomically. Throws CounterNotFoundError, or CounterBoundError below zero. */
  decrement(name: string, by: number): Counter;
  /** Up to `limit` (an integer >= 1; RangeError otherwise) counters whose name sorts after `after`, by
   * name; `next` is set when more follow. */
  list(after: string | undefined, limit: number): CounterPage;
  close(): void;
}

export interface CounterPage {
  counters: Counter[];
  /** The last name on this page, present only when more counters follow it. */
  next?: string;
}

/** The largest value a counter may hold: beyond it a JS number can no longer represent every integer. */
export const MAX_VALUE = Number.MAX_SAFE_INTEGER;

export class CounterNotFoundError extends Error {
  constructor(name: string) {
    super(`counter not found: ${name}`);
    this.name = 'CounterNotFoundError';
  }
}

export class CounterBoundError extends Error {
  constructor(
    name: string,
    readonly bound: 'zero' | 'max',
  ) {
    super(`counter ${bound === 'zero' ? 'cannot go below zero' : 'would exceed the maximum value'}: ${name}`);
    this.name = 'CounterBoundError';
  }
}

export class CounterExistsError extends Error {
  constructor(name: string) {
    super(`counter already exists: ${name}`);
    this.name = 'CounterExistsError';
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; errcode?: unknown; message?: unknown };
  // node:sqlite reports SQLITE_CONSTRAINT_PRIMARYKEY (1555) / SQLITE_CONSTRAINT_UNIQUE (2067) as errcode.
  return (
    e?.code === 'ERR_SQLITE_ERROR' &&
    (e.errcode === 1555 || e.errcode === 2067 || /UNIQUE constraint failed/.test(String(e.message)))
  );
}

export function sqliteStore(path: string): CounterStore {
  const db = new DatabaseSync(path);
  // Another connection holding the write lock makes this one WAIT (up to 5 s) rather than fail with
  // SQLITE_BUSY: measured, two processes bumping one file crash with "database is locked" without it.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(
    'CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL DEFAULT 0)',
  );
  const insert = db.prepare('INSERT INTO counters (name, value) VALUES (?, 0)');
  const select = db.prepare('SELECT name, value FROM counters WHERE name = ?');
  // One guarded statement per bump: the bound is checked and the value changed in the same UPDATE, so
  // concurrent bumps never lose an update and a refused bump changes nothing.
  const up = db.prepare('UPDATE counters SET value = value + ? WHERE name = ? AND value <= ? RETURNING value');
  const down = db.prepare('UPDATE counters SET value = value - ? WHERE name = ? AND value >= ? RETURNING value');
  // One page by name; the primary key's index serves the range and the order. Fetches limit + 1 rows:
  // the extra row only tells whether another page follows.
  const page = db.prepare('SELECT name, value FROM counters WHERE name > ? ORDER BY name LIMIT ?');

  // No row came back: the counter is missing, or the bound held. This read only names the error.
  const refused = (name: string, bound: 'zero' | 'max'): never => {
    if (!select.get(name)) throw new CounterNotFoundError(name);
    throw new CounterBoundError(name, bound);
  };

  return {
    create(name) {
      try {
        insert.run(name);
      } catch (err) {
        if (isUniqueViolation(err)) throw new CounterExistsError(name);
        throw err;
      }
      return { name, value: 0 };
    },
    get(name) {
      const row = select.get(name) as { name: string; value: number } | undefined;
      return row ? { name: row.name, value: Number(row.value) } : undefined;
    },
    increment(name, by) {
      const row = up.get(by, name, MAX_VALUE - by) as { value: number } | undefined;
      if (!row) return refused(name, 'max');
      return { name, value: Number(row.value) };
    },
    decrement(name, by) {
      const row = down.get(by, name, by) as { value: number } | undefined;
      if (!row) return refused(name, 'zero');
      return { name, value: Number(row.value) };
    },
    list(after, limit) {
      // SQLite reads a negative LIMIT as "no limit", so the store guards its own precondition.
      if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be an integer >= 1');
      const rows = page.all(after ?? '', limit + 1) as Array<{ name: string; value: number }>;
      const counters = rows.slice(0, limit).map((r) => ({ name: r.name, value: Number(r.value) }));
      return rows.length > limit ? { counters, next: counters[counters.length - 1].name } : { counters };
    },
    close() {
      db.close();
    },
  };
}
