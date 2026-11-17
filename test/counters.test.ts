import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { sqliteStore, type CounterStore } from '../src/store.js';

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
      ['a number, not a string', 42],
      ['null', null],
    ];
    it.each(invalidNames)('rejects invalid names with 400 and stores nothing: %s', async (_label, name) => {
      const res = await request(app).post('/counters').send({ name });
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
      if (typeof name === 'string') expect(store.get(name)).toBeUndefined();
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

    it.each([['uppercase', 'Standup'], ['leading hyphen', '-standup'], ['65 characters', 'a'.repeat(65)]])(
      'answers 400 for an invalid name: %s',
      async (_label, name) => {
        const res = await request(app).get(`/counters/${name}`);
        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe('string');
      },
    );
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
