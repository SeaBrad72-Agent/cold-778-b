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
  /** Remove `name`, whatever its value; true when a counter was removed, false when there was none. */
  delete(name: string): boolean;
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

export interface StoreOptions {
  /** How long to wait for another connection's lock before failing with "database is locked"
   * (default 5000 ms). Tests lower it to stay fast. */
  busyTimeoutMs?: number;
  /** TEST-ONLY seam: called inside a refused bump's transaction, after the guarded UPDATE and before the
   * read that names the refusal. Tests use it to race another connection against that exact window,
   * deterministically (timing-based two-process versions were flaky; COLD-9 review). Never set in
   * production code: server.ts does not pass it. */
  betweenUpdateAndClassify?: (name: string) => void;
}

export function sqliteStore(path: string, options: StoreOptions = {}): CounterStore {
  const db = new DatabaseSync(path);
  // Another connection holding a lock makes this one wait, up to busyTimeoutMs, and then fail with
  // SQLITE_BUSY ("database is locked"); SQLite's busy wait is not fair, so under sustained writes from
  // another process a rare wait can still time out (measured, COLD-9 review). Without any timeout, two
  // processes bumping one file crash on the first contention (measured, COLD-6).
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) throw new RangeError('busyTimeoutMs must be an integer >= 0');
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
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

  const remove = db.prepare('DELETE FROM counters WHERE name = ?');

  // One bump: the guarded UPDATE and, when it returns no row, the read that names the refusal, run in
  // ONE write transaction (COLD-9, closing the COLD-6 carried item). With delete in the API, another
  // connection could otherwise delete or create the row between the two statements and the refusal
  // reported would not be the one the UPDATE met. BEGIN IMMEDIATE takes the write lock up front; a
  // contended BEGIN or COMMIT waits up to busy_timeout and then THROWS (rolled back below), so a bump
  // never answers success for a write that did not commit (COLD-9 security L2: the old auto-commit
  // swallowed a busy COMMIT and reported a success that was never stored).
  const bump = (
    stmt: typeof up,
    name: string,
    by: number,
    guard: number,
    bound: 'zero' | 'max',
  ): Counter => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = stmt.get(by, name, guard) as { value: number } | undefined;
      if (!row) options.betweenUpdateAndClassify?.(name);
      const exists = row !== undefined || select.get(name) !== undefined;
      db.exec('COMMIT');
      if (row) return { name, value: Number(row.value) };
      if (!exists) throw new CounterNotFoundError(name);
      throw new CounterBoundError(name, bound);
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw err;
    }
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
      return bump(up, name, by, MAX_VALUE - by, 'max');
    },
    decrement(name, by) {
      return bump(down, name, by, by, 'zero');
    },
    delete(name) {
      return remove.run(name).changes > 0;
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
