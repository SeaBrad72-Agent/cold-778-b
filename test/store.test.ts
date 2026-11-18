import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { bumpFromTwoProcesses } from './helpers/two-process.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  CounterBoundError,
  CounterExistsError,
  CounterNotFoundError,
  MAX_VALUE,
  sqliteStore,
  type CounterStore,
} from '../src/store.js';

describe('sqliteStore', () => {
  const open: CounterStore[] = [];
  const dirs: string[] = [];
  const mem = (): CounterStore => {
    const s = sqliteStore(':memory:');
    open.push(s);
    return s;
  };

  afterEach(() => {
    for (const s of open.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('creates a counter at zero and reads it back', () => {
    const store = mem();
    expect(store.create('coffee-runs')).toEqual({ name: 'coffee-runs', value: 0 });
    expect(store.get('coffee-runs')).toEqual({ name: 'coffee-runs', value: 0 });
  });

  it('returns undefined for an unknown counter', () => {
    expect(mem().get('nope')).toBeUndefined();
  });

  it('duplicate create throws and keeps the value', () => {
    const store = mem();
    store.create('bugs');
    expect(() => store.create('bugs')).toThrow(CounterExistsError);
    expect(store.get('bugs')).toEqual({ name: 'bugs', value: 0 });
  });

  it('stores a name containing SQL metacharacters verbatim', () => {
    const store = mem();
    const name = "x'); DROP TABLE counters; --";
    store.create(name);
    expect(store.get(name)).toEqual({ name, value: 0 });
    expect(store.get('coffee-runs')).toBeUndefined();
    store.create('still-works');
    expect(store.get('still-works')).toEqual({ name: 'still-works', value: 0 });
  });

  describe('increment and decrement', () => {
    it('increments by 1 and by n', () => {
      const store = mem();
      store.create('coffee');
      expect(store.increment('coffee', 1)).toEqual({ name: 'coffee', value: 1 });
      expect(store.increment('coffee', 5)).toEqual({ name: 'coffee', value: 6 });
      expect(store.get('coffee')).toEqual({ name: 'coffee', value: 6 });
    });

    it('decrements by 1 and by n, down to exactly zero', () => {
      const store = mem();
      store.create('bugs');
      store.increment('bugs', 4);
      expect(store.decrement('bugs', 1)).toEqual({ name: 'bugs', value: 3 });
      expect(store.decrement('bugs', 3)).toEqual({ name: 'bugs', value: 0 });
    });

    it('decrement below zero is refused and keeps the value', () => {
      const store = mem();
      store.create('standup');
      store.increment('standup', 2);
      expect(() => store.decrement('standup', 3)).toThrow(CounterBoundError);
      expect(store.get('standup')).toEqual({ name: 'standup', value: 2 });
      store.decrement('standup', 2);
      expect(() => store.decrement('standup', 1)).toThrow(CounterBoundError);
      expect(store.get('standup')).toEqual({ name: 'standup', value: 0 });
    });

    it('increment past the maximum is refused and keeps the value', () => {
      // Reaching the top through the API would take ~9e9 calls, so the test sets the stored value
      // directly through a second connection to the same file, then bumps through the store.
      const dir = mkdtempSync(join(tmpdir(), 'tally-store-'));
      dirs.push(dir);
      const path = join(dir, 'tally.db');
      const store = sqliteStore(path);
      open.push(store);
      store.create('big');
      const raw = new DatabaseSync(path);
      const set = (v: number) => raw.prepare('UPDATE counters SET value = ? WHERE name = ?').run(v, 'big');

      set(MAX_VALUE - 1);
      expect(store.increment('big', 1)).toEqual({ name: 'big', value: MAX_VALUE });
      expect(() => store.increment('big', 1)).toThrow(CounterBoundError);
      expect(store.get('big')).toEqual({ name: 'big', value: MAX_VALUE });

      set(MAX_VALUE - 999_999);
      expect(() => store.increment('big', 1_000_000)).toThrow(CounterBoundError);
      expect(store.get('big')).toEqual({ name: 'big', value: MAX_VALUE - 999_999 });
      raw.close();
    });

    it('bumping an unknown counter throws CounterNotFoundError', () => {
      const store = mem();
      expect(() => store.increment('nope', 1)).toThrow(CounterNotFoundError);
      expect(() => store.decrement('nope', 1)).toThrow(CounterNotFoundError);
      expect(store.get('nope')).toBeUndefined();
    });

    // Two OS processes, released together by a rendezvous, bump the same file at the same time. A
    // read-then-write store loses updates here (the helper's `mutant` mode, measured by hand); the
    // store's single guarded UPDATE does not.
    it('two processes bumping the same file concurrently lose no update', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tally-store-'));
      dirs.push(dir);
      const path = join(dir, 'tally.db');
      const setup = sqliteStore(path);
      setup.create('shared');
      setup.close();

      const perChild = 2000;
      expect(await bumpFromTwoProcesses(path, 'shared', perChild)).toEqual([0, 0]);

      const check = sqliteStore(path);
      open.push(check);
      expect(check.get('shared')).toEqual({ name: 'shared', value: 2 * perChild });
    }, 30_000);
  });

  describe('list', () => {
    const seeded = (...names: string[]) => {
      const store = mem();
      for (const n of names) store.create(n);
      return store;
    };

    it('returns an empty list when there are no counters', () => {
      expect(mem().list(undefined, 100)).toEqual({ counters: [] });
    });

    it('returns counters sorted by name with their values', () => {
      const store = seeded('coffee', 'bugs', 'standup');
      store.increment('bugs', 3);
      expect(store.list(undefined, 100)).toEqual({
        counters: [
          { name: 'bugs', value: 3 },
          { name: 'coffee', value: 0 },
          { name: 'standup', value: 0 },
        ],
      });
    });

    it('caps a page at the limit, sets next, and continues after it', () => {
      const store = seeded('a', 'b', 'c', 'd', 'e');
      const first = store.list(undefined, 2);
      expect(first).toEqual({ counters: [{ name: 'a', value: 0 }, { name: 'b', value: 0 }], next: 'b' });
      expect(store.list(first.next, 2)).toEqual({
        counters: [{ name: 'c', value: 0 }, { name: 'd', value: 0 }],
        next: 'd',
      });
      expect(store.list('d', 2)).toEqual({ counters: [{ name: 'e', value: 0 }] });
    });

    it('sets no next when the page is exactly full and nothing follows', () => {
      expect(seeded('a', 'b').list(undefined, 2)).toEqual({
        counters: [{ name: 'a', value: 0 }, { name: 'b', value: 0 }],
      });
    });

    it('continues after a name that does not exist', () => {
      expect(seeded('apple', 'cherry').list('banana', 10)).toEqual({ counters: [{ name: 'cherry', value: 0 }] });
    });

    it.each([0, -2, 1.5, Number.NaN])('refuses a limit that is not an integer >= 1: %s', (limit) => {
      const store = seeded('a', 'b');
      expect(() => store.list(undefined, limit)).toThrow(RangeError);
    });

    it('walking every page returns every counter once', () => {
      const names = Array.from({ length: 237 }, (_, i) => `c-${String(i).padStart(3, '0')}`);
      const store = seeded(...[...names].reverse());
      const seen: string[] = [];
      let after: string | undefined;
      for (let page = 0; page < 100; page++) {
        const { counters, next } = store.list(after, 10);
        seen.push(...counters.map((c) => c.name));
        if (!next) break;
        after = next;
      }
      expect(seen).toEqual(names);
    });
  });

  describe('delete', () => {
    it('deletes an existing counter and it is gone from get and list', () => {
      const store = mem();
      store.create('a');
      store.create('b');
      expect(store.delete('a')).toBe(true);
      expect(store.get('a')).toBeUndefined();
      expect(store.list(undefined, 10)).toEqual({ counters: [{ name: 'b', value: 0 }] });
    });

    it('returns false for an unknown counter, and on a second delete', () => {
      const store = mem();
      expect(store.delete('nope')).toBe(false);
      store.create('once');
      expect(store.delete('once')).toBe(true);
      expect(store.delete('once')).toBe(false);
    });

    it('deletes a counter whatever its value', () => {
      const store = mem();
      store.create('busy');
      store.increment('busy', 42);
      expect(store.delete('busy')).toBe(true);
      expect(store.get('busy')).toBeUndefined();
    });

    it('a bump after a delete throws CounterNotFoundError', () => {
      const store = mem();
      store.create('gone');
      store.delete('gone');
      expect(() => store.increment('gone', 1)).toThrow(CounterNotFoundError);
      expect(() => store.decrement('gone', 1)).toThrow(CounterNotFoundError);
    });

    it('a deleted name can be created again, from zero', () => {
      const store = mem();
      store.create('again');
      store.increment('again', 3);
      store.delete('again');
      expect(store.create('again')).toEqual({ name: 'again', value: 0 });
    });

    // Security COLD-9 L2: on the pre-transaction code an auto-commit that hit SQLITE_BUSY was swallowed,
    // so a bump answered success while the stored value never changed. Now the explicit COMMIT throws
    // and is rolled back. This test FAILS without the transaction (the bump "succeeds" silently).
    it('a bump whose commit is blocked by a reader fails loudly and changes nothing', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tally-store-'));
      dirs.push(dir);
      const path = join(dir, 'tally.db');
      const store = sqliteStore(path, { busyTimeoutMs: 50 });
      open.push(store);
      store.create('b');
      const reader = new DatabaseSync(path);
      reader.exec('BEGIN');
      reader.prepare('SELECT value FROM counters WHERE name = ?').get('b'); // holds a SHARED lock
      expect(() => store.increment('b', 1)).toThrow(/database is locked/);
      reader.exec('COMMIT');
      reader.close();
      expect(store.get('b')).toEqual({ name: 'b', value: 0 });
      expect(store.increment('b', 1)).toEqual({ name: 'b', value: 1 }); // the store is usable again
    });

    it.each([-1, 1.5, Number.NaN])('refuses a busyTimeoutMs that is not an integer >= 0: %s', (ms) => {
      expect(() => sqliteStore(':memory:', { busyTimeoutMs: ms })).toThrow(RangeError);
    });

    it('rolls back a bump whose statement fails, so the next bump still works', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tally-store-'));
      dirs.push(dir);
      const path = join(dir, 'tally.db');
      const store = sqliteStore(path);
      open.push(store);
      store.create('x');
      const raw = new DatabaseSync(path);
      raw.exec('DROP TABLE counters');
      expect(() => store.increment('x', 1)).toThrow(/no such table/);
      raw.exec('CREATE TABLE counters (name TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL DEFAULT 0)');
      raw.close();
      store.create('x');
      // Without the rollback the store's open transaction keeps the write lock, so the CREATE TABLE
      // above fails with "database is locked" (measured).
      expect(store.increment('x', 1)).toEqual({ name: 'x', value: 1 });
    });

    // Deterministic race tests (COLD-9 review I1). A test-only hook runs between a bump's guarded UPDATE
    // and the read that names its refusal; from there another connection tries to change the row. With
    // the transaction, that write is blocked (the bump holds the write lock), so the refusal is the one
    // the UPDATE met. Without it, the write lands and the refusal is misnamed. Timing-based two-process
    // versions of these tests were flaky under CPU contention (2 failures in 20, measured) and are gone.
    const raced = (setup: (store: CounterStore) => void, interloper: (raw: DatabaseSync) => void) => {
      const dir = mkdtempSync(join(tmpdir(), 'tally-store-'));
      dirs.push(dir);
      const path = join(dir, 'tally.db');
      const outcomes: string[] = [];
      const raw = new DatabaseSync(path, { timeout: 0 });
      const store = sqliteStore(path, {
        busyTimeoutMs: 50,
        betweenUpdateAndClassify: () => {
          try {
            interloper(raw);
            outcomes.push('interloper wrote');
          } catch (err) {
            outcomes.push(`interloper blocked: ${(err as Error).message}`);
          }
        },
      });
      open.push(store);
      setup(store);
      return { store, raw, outcomes };
    };

    it('an increment on a deleted counter is reported not found even if it is re-created mid-bump', () => {
      const { store, raw, outcomes } = raced(
        () => {},
        (db) => db.prepare('INSERT INTO counters (name, value) VALUES (?, 0)').run('ghost'),
      );
      expect(() => store.increment('ghost', 1)).toThrow(CounterNotFoundError);
      expect(outcomes).toEqual(['interloper blocked: database is locked']);
      raw.close();
    });

    it('a decrement at zero is reported as the bound even if the counter is deleted mid-bump', () => {
      const { store, raw, outcomes } = raced(
        (s) => s.create('zero'),
        (db) => db.prepare('DELETE FROM counters WHERE name = ?').run('zero'),
      );
      expect(() => store.decrement('zero', 1)).toThrow(CounterBoundError);
      expect(outcomes).toEqual(['interloper blocked: database is locked']);
      expect(store.get('zero')).toEqual({ name: 'zero', value: 0 });
      raw.close();
    });

    it('the hook runs only when a bump is refused', () => {
      let calls = 0;
      const store = sqliteStore(':memory:', { betweenUpdateAndClassify: () => calls++ });
      open.push(store);
      store.create('ok');
      store.increment('ok', 1);
      expect(calls).toBe(0);
      expect(() => store.decrement('ok', 5)).toThrow(CounterBoundError);
      expect(calls).toBe(1);
    });
  });

  it('passes through an unexpected database error instead of reporting a duplicate', () => {
    const store = sqliteStore(':memory:');
    store.close();
    let thrown: unknown;
    try {
      store.create('after-close');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(CounterExistsError);
  });

  it('keeps counters across a restart on a file database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tally-store-'));
    dirs.push(dir);
    const path = join(dir, 'tally.db');
    const first = sqliteStore(path);
    first.create('standup');
    first.close();

    const second = sqliteStore(path);
    open.push(second);
    expect(second.get('standup')).toEqual({ name: 'standup', value: 0 });
  });
});
