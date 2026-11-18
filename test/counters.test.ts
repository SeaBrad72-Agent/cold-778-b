import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { CounterBoundError, sqliteStore, type CounterStore } from '../src/store.js';
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
      // An empty name leaves `/counters/`, which is the list (COLD-8), not a name lookup: skip it here.
      if (typeof name === 'string' && name !== '') {
        const get = await request(guarded).get(`/counters/${encodeURIComponent(name)}`);
        expect(get.status).toBe(400);
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

  describe('POST /counters/:name/increment and /decrement', () => {
    beforeEach(() => {
      store.create('coffee');
    });

    it('increments by 1 with no body and answers 200 with the new value', async () => {
      const res = await request(app).post('/counters/coffee/increment');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).toEqual({ name: 'coffee', value: 1 });
      expect(store.get('coffee')).toEqual({ name: 'coffee', value: 1 });
    });

    it('increments by n with {"by": n}, and by 1 with an empty object', async () => {
      expect((await request(app).post('/counters/coffee/increment').send({ by: 5 })).body).toEqual({
        name: 'coffee',
        value: 5,
      });
      expect((await request(app).post('/counters/coffee/increment').send({})).body).toEqual({
        name: 'coffee',
        value: 6,
      });
    });

    it('decrements by 1 and by n, down to exactly zero', async () => {
      store.increment('coffee', 4);
      expect((await request(app).post('/counters/coffee/decrement')).body).toEqual({ name: 'coffee', value: 3 });
      const res = await request(app).post('/counters/coffee/decrement').send({ by: 3 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ name: 'coffee', value: 0 });
    });

    it('refuses a decrement below zero with 409 and keeps the value', async () => {
      store.increment('coffee', 2);
      const res = await request(app).post('/counters/coffee/decrement').send({ by: 3 });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'counter cannot go below zero' });
      expect(store.get('coffee')).toEqual({ name: 'coffee', value: 2 });
    });

    it('refuses an increment past the maximum with 409', async () => {
      const capped: CounterStore = {
        ...store,
        increment(name) {
          throw new CounterBoundError(name, 'max');
        },
      };
      const res = await request(createApp(capped)).post('/counters/coffee/increment');
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'counter would exceed the maximum value' });
    });

    it.each(['increment', 'decrement'])('answers 404 for an unknown counter on %s', async (op) => {
      const res = await request(app).post(`/counters/nope/${op}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'counter not found' });
    });

    const invalidBy: Array<[string, unknown]> = [
      ['zero', 0],
      ['negative', -1],
      ['a fraction', 1.5],
      ['over a million', 1_000_001],
      ['a numeric string', '5'],
      ['null', null],
      ['a boolean', true],
      ['an array', [1]],
      ['an object', { n: 1 }],
      ['a huge number', 1e308],
    ];
    it.each(invalidBy)('rejects an invalid "by" with 400 and changes nothing: %s', async (_label, by) => {
      for (const op of ['increment', 'decrement']) {
        const res = await request(app).post(`/counters/coffee/${op}`).send({ by });
        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe('string');
      }
      expect(store.get('coffee')).toEqual({ name: 'coffee', value: 0 });
    });

    it('accepts the largest valid "by" (1,000,000)', async () => {
      const res = await request(app).post('/counters/coffee/increment').send({ by: 1_000_000 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ name: 'coffee', value: 1_000_000 });
    });

    it('rejects a JSON body that is not an object with 400', async () => {
      const res = await request(app)
        .post('/counters/coffee/increment')
        .set('Content-Type', 'application/json')
        .send('[5]');
      expect(res.status).toBe(400);
      expect(store.get('coffee')).toEqual({ name: 'coffee', value: 0 });
    });

    it.each(['increment', 'decrement'])('rejects a JSON null body on %s with 400 and changes nothing', async (op) => {
      store.increment('coffee', 5);
      const res = await request(app).post(`/counters/coffee/${op}`).set('Content-Type', 'application/json').send('null');
      expect(res.status).toBe(400);
      expect(store.get('coffee')).toEqual({ name: 'coffee', value: 5 });
    });

    // A client that forgets the JSON header must not get a silent +1 for its {"by": 5}.
    it.each([
      ['text/plain', 'text/plain'],
      ['a form body (curl -d without -H)', 'application/x-www-form-urlencoded'],
      ['no content type', undefined],
    ])('refuses a non-JSON body (%s) with 415 and changes nothing', async (_label, type) => {
      store.increment('coffee', 5);
      for (const op of ['increment', 'decrement']) {
        const req = request(app).post(`/counters/coffee/${op}`);
        if (type) req.set('Content-Type', type);
        else req.unset('Content-Type');
        const res = await req.send('{"by":5}');
        expect(res.status).toBe(415);
        expect(res.body).toEqual({ error: 'unsupported content type or encoding' });
      }
      expect(store.get('coffee')).toEqual({ name: 'coffee', value: 5 });
    });

    it('refuses a body over 1kb with 413', async () => {
      const res = await request(app)
        .post('/counters/coffee/increment')
        .send({ by: 1, padding: 'x'.repeat(2048) });
      expect(res.status).toBe(413);
      expect(store.get('coffee')).toEqual({ name: 'coffee', value: 0 });
    });

    // The design-promised control: an invalid name or "by" never reaches storage.
    it.each([
      ['an uppercase name', 'Coffee', { by: 1 }],
      ['a leading-hyphen name', '-coffee', { by: 1 }],
      ['an encoded newline in the name', 'abc%0A', { by: 1 }],
      ['a zero by', 'coffee', { by: 0 }],
      ['a string by', 'coffee', { by: '1' }],
      ['a fractional by', 'coffee', { by: 0.5 }],
    ])('never calls the store for an invalid bump: %s', async (_label, name, body) => {
      const calls: string[] = [];
      const guarded = createApp(tripwireStore(calls));
      for (const op of ['increment', 'decrement']) {
        const res = await request(guarded).post(`/counters/${name}/${op}`).send(body);
        expect(res.status).toBe(400);
      }
      expect(calls).toEqual([]);
    });

    it('sends the security headers on bump responses, including a 409', async () => {
      const res = await request(app).post('/counters/coffee/decrement');
      expect(res.status).toBe(409);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    });
  });

  describe('GET /counters (list)', () => {
    it('answers 200 with an empty list when there are no counters', async () => {
      const res = await request(app).get('/counters');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).toEqual({ counters: [] });
    });

    it('lists counters sorted by name with their values, on /counters and /counters/', async () => {
      store.create('coffee');
      store.create('bugs');
      store.increment('bugs', 2);
      const expected = { counters: [{ name: 'bugs', value: 2 }, { name: 'coffee', value: 0 }] };
      expect((await request(app).get('/counters')).body).toEqual(expected);
      expect((await request(app).get('/counters/')).body).toEqual(expected);
    });

    it('defaults to 100 per page', async () => {
      for (let i = 0; i < 101; i++) store.create(`c-${String(i).padStart(3, '0')}`);
      const res = await request(app).get('/counters');
      expect(res.body.counters).toHaveLength(100);
      expect(res.body.next).toBe('c-099');
    });

    it('caps a page at the limit and sets next', async () => {
      for (const n of ['a', 'b', 'c']) store.create(n);
      const first = await request(app).get('/counters?limit=2');
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ counters: [{ name: 'a', value: 0 }, { name: 'b', value: 0 }], next: 'b' });
      const second = await request(app).get(`/counters?limit=2&after=${first.body.next}`);
      expect(second.body).toEqual({ counters: [{ name: 'c', value: 0 }] });
    });

    it('accepts the largest limit (1000)', async () => {
      store.create('a');
      const res = await request(app).get('/counters?limit=1000');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ counters: [{ name: 'a', value: 0 }] });
    });

    const invalidQueries: Array<[string, string]> = [
      ['limit 0', 'limit=0'],
      ['limit 1001', 'limit=1001'],
      ['a negative limit', 'limit=-1'],
      ['a fractional limit', 'limit=1.5'],
      ['a word limit', 'limit=abc'],
      ['an empty limit', 'limit='],
      ['an exponent limit', 'limit=1e2'],
      ['a leading-zero limit', 'limit=010'],
      ['a repeated limit', 'limit=1&limit=2'],
      ['an uppercase after', 'after=Coffee'],
      ['a too-long after', `after=${'a'.repeat(65)}`],
      ['an encoded newline in after', 'after=abc%0A'],
      ['a repeated after', 'after=a&after=b'],
      ['a bracketed after', 'after[x]=a'],
      // Security round 1, L2: one row per further attack shape.
      ['a __proto__ key', '__proto__=x'],
      ['a constructor key', 'constructor=x'],
      ['a nested constructor key', 'constructor[prototype][x]=1'],
      ['a plain unknown key', '_=1'],
      ['a signed limit', 'limit=%2B1'],
      ['a limit with a trailing space', 'limit=1%20'],
      ['a fullwidth-digit limit', 'limit=%EF%BC%91'],
      ['a limit with a NUL', 'limit=1%00'],
      ['a SQL-shaped after', "after=a'%20OR%201=1--"],
      ['an empty after', 'after='],
      ['an after with no value', 'after'],
      ['a limit with no value', 'limit'],
      ['an empty key', '=x'],
      // Security round 1, L1: Node's parser kept only the first 1000 pairs, so a long run of '&' hid the rest.
      ['a parameter after 1000 empty pairs', `${'&'.repeat(1000)}limit=5000`],
      ['an unknown key after 1000 empty pairs', `${'&'.repeat(1000)}evil=1`],
    ];
    it.each(invalidQueries)('rejects an invalid query with 400: %s', async (_label, query) => {
      const res = await request(app).get(`/counters?${query}`);
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
    });

    it.each(invalidQueries)('never calls the store for an invalid list query: %s', async (_label, query) => {
      const calls: string[] = [];
      const res = await request(createApp(tripwireStore(calls))).get(`/counters?${query}`);
      expect(res.status).toBe(400);
      expect(calls).toEqual([]);
    });

    it('names the offending parameter when after is repeated', async () => {
      const res = await request(app).get('/counters?after=a&after=b');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'after must be a single counter name' });
    });

    it('sends the security headers on the list', async () => {
      const res = await request(app).get('/counters');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    });
  });
});
