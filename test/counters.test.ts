import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { sqliteStore, type CounterStore } from '../src/store.js';
import { tripwireStore } from './fakes.js';

describe('counters API', () => {
  let store: CounterStore;
  let app: Express;

  beforeEach(() => {
    store = sqliteStore(':memory:');
    app = createApp(store);
  });
  afterEach(() => store.close());

  describe('POST /counters', () => {
    it('creates a counter at 0 with 201', async () => {
      const res = await request(app).post('/counters').send({ name: 'coffee-runs' });
      expect(res.status).toBe(201);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).toEqual({ name: 'coffee-runs', value: 0 });
      expect(store.get('coffee-runs')).toEqual({ name: 'coffee-runs', value: 0 });
    });

    it('answers 409 for an existing name and keeps the value', async () => {
      await request(app).post('/counters').send({ name: 'bugs' });
      const res = await request(app).post('/counters').send({ name: 'bugs' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'counter already exists' });
      expect(store.get('bugs')).toEqual({ name: 'bugs', value: 0 });
    });

    it('accepts the longest valid name (64 characters)', async () => {
      const name = 'a'.repeat(64);
      const res = await request(app).post('/counters').send({ name });
      expect(res.status).toBe(201);
    });

    const invalidNames: Array<[string, unknown]> = [
      ['empty', ''],
      ['65 characters', 'a'.repeat(65)],
      ['uppercase', 'Coffee'],
      ['leading hyphen', '-coffee'],
      ['a space', 'coffee runs'],
      ['a slash', 'coffee/runs'],
      ['SQL metacharacters', "x'); DROP TABLE counters; --"],
      ['a trailing newline', 'abc\n'],
      ['a non-ASCII letter', 'café'],
      ['a fullwidth digit', '１'],
      ['an embedded NUL', 'a\u0000b'],
      ['a number, not a string', 42],
      ['null', null],
      ['an array', ['coffee']],
      ['an object', { value: 'coffee' }],
    ];
    it.each(invalidNames)('rejects invalid names with 400 and stores nothing: %s', async (_label, name) => {
      const res = await request(app).post('/counters').send({ name });
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
      if (typeof name === 'string') expect(store.get(name)).toBeUndefined();
    });

    // The design-promised control: an invalid name is refused BEFORE any storage call.
    it.each(invalidNames)('never calls the store for an invalid name: %s', async (_label, name) => {
      const calls: string[] = [];
      const guarded = createApp(tripwireStore(calls));
      const post = await request(guarded).post('/counters').send({ name });
      expect(post.status).toBe(400);
      if (typeof name === 'string') {
        const get = await request(guarded).get(`/counters/${encodeURIComponent(name)}`);
        // An empty name leaves `/counters/`, which no route matches yet (404); every other name is a 400.
        expect(get.status).toBe(name === '' ? 404 : 400);
      }
      expect(calls).toEqual([]);
    });

    it('drops prototype-pollution keys: the valid name creates and Object.prototype stays clean', async () => {
      const res = await request(app)
        .post('/counters')
        .set('Content-Type', 'application/json')
        .send('{"name":"coffee","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ name: 'coffee', value: 0 });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('rejects a JSON-looking body sent as text/plain with 400', async () => {
      const res = await request(app).post('/counters').set('Content-Type', 'text/plain').send('{"name":"coffee"}');
      expect(res.status).toBe(400);
      expect(store.get('coffee')).toBeUndefined();
    });

    it('rejects a body with no name with 400', async () => {
      const res = await request(app).post('/counters').send({});
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
    });

    it('rejects a JSON body that is not an object with 400', async () => {
      const res = await request(app).post('/counters').set('Content-Type', 'application/json').send('["coffee"]');
      expect(res.status).toBe(400);
    });

    it('rejects a missing body with 400', async () => {
      const res = await request(app).post('/counters');
      expect(res.status).toBe(400);
    });

    it('rejects a malformed JSON body with 400', async () => {
      const res = await request(app).post('/counters').set('Content-Type', 'application/json').send('{"name":');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'request body is not valid JSON' });
    });

    it('answers 415 with a request-side message for an unsupported charset', async () => {
      const res = await request(app)
        .post('/counters')
        .set('Content-Type', 'application/json; charset=latin1')
        .send('{"name":"coffee"}');
      expect(res.status).toBe(415);
      expect(res.body).toEqual({ error: 'unsupported content type or encoding' });
    });

    it('answers 415 with a request-side message for an unsupported content encoding', async () => {
      const res = await request(app)
        .post('/counters')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'foo')
        .send('{"name":"coffee"}');
      expect(res.status).toBe(415);
      expect(res.body).toEqual({ error: 'unsupported content type or encoding' });
    });

    it('refuses a body over 1kb with 413', async () => {
      const res = await request(app)
        .post('/counters')
        .send({ name: 'coffee', padding: 'x'.repeat(2048) });
      expect(res.status).toBe(413);
      expect(res.body).toEqual({ error: 'request body too large' });
      expect(store.get('coffee')).toBeUndefined();
    });
  });

  describe('GET /counters/:name', () => {
    it('reads an existing counter with 200', async () => {
      store.create('standup');
      const res = await request(app).get('/counters/standup');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ name: 'standup', value: 0 });
    });

    it('answers 404 for an unknown counter', async () => {
      const res = await request(app).get('/counters/nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'counter not found' });
    });

    it.each([
      ['uppercase', 'Standup'],
      ['leading hyphen', '-standup'],
      ['65 characters', 'a'.repeat(65)],
      ['an encoded slash', 'a%2Fb'],
      ['an encoded NUL', 'a%00b'],
      ['an encoded trailing newline', 'abc%0A'],
      ['SQL metacharacters', "x'%20OR%201=1--"],
    ])(
      'answers 400 for an invalid name: %s',
      async (_label, name) => {
        const res = await request(app).get(`/counters/${name}`);
        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe('string');
      },
    );
  });

  it('answers a malformed percent-encoded name with a generic 400, not a body error', async () => {
    const res = await request(app).get('/counters/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad request' });
  });

  it('round-trips: a created counter reads back', async () => {
    await request(app).post('/counters').send({ name: 'round-trip' });
    const res = await request(app).get('/counters/round-trip');
    expect(res.body).toEqual({ name: 'round-trip', value: 0 });
  });

  it('sends the security headers on counter responses', async () => {
    const res = await request(app).post('/counters').send({ name: 'headers' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
