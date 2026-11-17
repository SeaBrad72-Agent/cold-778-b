import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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

    it('two connections interleaving increments lose no update', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tally-store-'));
      dirs.push(dir);
      const path = join(dir, 'tally.db');
      const a = sqliteStore(path);
      const b = sqliteStore(path);
      open.push(a, b);
      a.create('shared');
      for (let i = 0; i < 100; i++) {
        a.increment('shared', 1);
        b.increment('shared', 1);
      }
      expect(a.get('shared')).toEqual({ name: 'shared', value: 200 });
      expect(b.get('shared')).toEqual({ name: 'shared', value: 200 });
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
