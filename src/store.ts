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
  close(): void;
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
  db.exec(
    'CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL DEFAULT 0)',
  );
  const insert = db.prepare('INSERT INTO counters (name, value) VALUES (?, 0)');
  const select = db.prepare('SELECT name, value FROM counters WHERE name = ?');

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
    close() {
      db.close();
    },
  };
}
