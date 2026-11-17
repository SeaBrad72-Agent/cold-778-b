import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { sqliteStore, type CounterStore } from '../src/store.js';

describe('app', () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.OTEL_TRACE_FILE;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('counts handled requests on /metrics by method and status', async () => {
    const app = createApp(sqliteStore(':memory:'));
    await request(app).get('/healthz');
    await request(app).get('/nope');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; version=0.0.4');
    expect(res.text).toContain('http_requests_total{method="GET",status="200"} 1');
    expect(res.text).toContain('http_requests_total{method="GET",status="404"} 1');
    expect(res.text).toMatch(/http_request_duration_seconds_total \d/);
  });

  it('answers 500 with no internal detail when the store fails unexpectedly', async () => {
    const failing: CounterStore = {
      create() {
        throw new Error('disk I/O error at /secret/path/tally.db');
      },
      get() {
        throw new Error('disk I/O error at /secret/path/tally.db');
      },
      close() {},
    };
    const app = createApp(failing);
    const post = await request(app).post('/counters').send({ name: 'boom' });
    expect(post.status).toBe(500);
    expect(post.body).toEqual({ error: 'internal error' });
    expect(post.text).not.toContain('secret');
    const get = await request(app).get('/counters/boom');
    expect(get.status).toBe(500);
    expect(get.body).toEqual({ error: 'internal error' });
  });

  it('writes one span per request to OTEL_TRACE_FILE when it is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tally-otel-'));
    dirs.push(dir);
    const file = join(dir, 'spans.jsonl');
    process.env.OTEL_TRACE_FILE = file;
    const app = createApp(sqliteStore(':memory:'));
    await request(app).get('/healthz?probe=1').set('x-request-id', 'req-123');
    const spans = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('GET /healthz');
    expect(spans[0].attributes.request_id).toBe('req-123');
    expect(spans[0].status).toEqual({ code: 'OK' });
  });
});
