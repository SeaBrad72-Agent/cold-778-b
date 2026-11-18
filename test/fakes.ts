// Test doubles for CounterStore, shared by the route and app tests.
import type { CounterStore } from '../src/store.js';

/** A store whose every data call throws `message` — drives the 500 path. */
export function failingStore(message: string): CounterStore {
  const fail = (): never => {
    throw new Error(message);
  };
  return { create: fail, get: fail, increment: fail, decrement: fail, delete: fail, list: fail, close() {} };
}

/** A store that records every data call in `calls` and throws — proves a request never reached storage. */
export function tripwireStore(calls: string[]): CounterStore {
  const trip =
    (op: string) =>
    (name?: string, by?: number): never => {
      calls.push(`${op}:${name ?? ''}${by === undefined ? '' : `:${by}`}`);
      throw new Error('store must not be called');
    };
  return {
    create: trip('create'),
    get: trip('get'),
    increment: trip('increment'),
    decrement: trip('decrement'),
    delete: trip('delete'),
    list: trip('list'),
    close() {},
  };
}
