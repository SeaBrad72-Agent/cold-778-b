import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CounterExistsError, sqliteStore, type CounterStore } from '../src/store.js';

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
