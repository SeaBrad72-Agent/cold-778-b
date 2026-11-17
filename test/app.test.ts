import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { sqliteStore } from '../src/store.js';
import { failingStore } from './fakes.js';

describe('app', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
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
    const app = createApp(failingStore('disk I/O error at /secret/path/tally.db'));
    const post = await request(app).post('/counters').send({ name: 'boom' });
    expect(post.status).toBe(500);
    expect(post.body).toEqual({ error: 'internal error' });
    expect(post.text).not.toContain('secret');
    const get = await request(app).get('/counters/boom');
    expect(get.status).toBe(500);
    expect(get.body).toEqual({ error: 'internal error' });
  });

  it('logs one error line naming the cause when the store fails, and marks the request line as error', async () => {
    const lines: Array<Record<string, unknown>> = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      if (typeof line === 'string' && line.startsWith('{"ts"')) lines.push(JSON.parse(line));
    });
    await request(createApp(failingStore('disk I/O error'))).post('/counters').set('x-request-id', 'req-500').send({ name: 'boom' });
    const errors = lines.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(2);
    const cause = errors.find((l) => l.event === 'unhandled_error');
    expect(cause).toMatchObject({ requestId: 'req-500', errorName: 'Error', errorMessage: 'disk I/O error' });
    expect(errors.find((l) => l.status === 500)).toMatchObject({ requestId: 'req-500', path: '/counters' });
  });

  it('logs ordinary requests at info level with the request fields', async () => {
    const lines: Array<Record<string, unknown>> = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      if (typeof line === 'string' && line.startsWith('{"ts"')) lines.push(JSON.parse(line));
    });
    await request(createApp(sqliteStore(':memory:'))).get('/healthz').set('x-request-id', 'req-ok');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      service: 'tally',
      requestId: 'req-ok',
      method: 'GET',
      path: '/healthz',
      status: 200,
    });
    expect(typeof lines[0].latencyMs).toBe('number');
  });

  it.each([
    ['markup', '<script>'],
    ['129 characters', 'a'.repeat(129)],
    ['a space', 'bad id'],
  ])('replaces an unsafe inbound request id (%s) with a minted one', async (_label, unsafe) => {
    const lines: Array<Record<string, unknown>> = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      if (typeof line === 'string' && line.startsWith('{"ts"')) lines.push(JSON.parse(line));
    });
    await request(createApp(sqliteStore(':memory:'))).get('/healthz').set('x-request-id', unsafe);
    expect(lines[0].requestId).not.toBe(unsafe);
    expect(String(lines[0].requestId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends the security headers on a 404', async () => {
    const res = await request(createApp(sqliteStore(':memory:'))).get('/nope');
    expect(res.status).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
  });

  it('names spans by route template, never by the raw URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tally-otel-'));
    dirs.push(dir);
    const file = join(dir, 'spans.jsonl');
    process.env.OTEL_TRACE_FILE = file;
    const app = createApp(sqliteStore(':memory:'));
    await request(app).get('/counters/coffee-runs');
    await request(app).get("/counters/x'%20OR%201=1--");
    await request(app).post('/counters').send({ name: 'standup' });
    await request(app).get(`/${'a'.repeat(4000)}`);
    // Error paths keep the route's name: a body-parser 400 and 413, and letter-case variants.
    await request(app).post('/counters').set('Content-Type', 'application/json').send('{"name":');
    await request(app).post('/counters').send({ name: 'x', padding: 'x'.repeat(2048) });
    await request(app).get('/CoUnTeRs/standup');
    const names = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l).name);
    expect(names).toEqual([
      'GET /counters/:name',
      'GET /counters/:name',
      'POST /counters',
      'GET unmatched',
      'POST /counters',
      'POST /counters',
      'GET /counters/:name',
    ]);
  });

  it('names a 500 span by its route on both counter routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tally-otel-'));
    dirs.push(dir);
    const file = join(dir, 'spans.jsonl');
    process.env.OTEL_TRACE_FILE = file;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const app = createApp(failingStore('disk I/O error'));
    await request(app).post('/counters').send({ name: 'boom' });
    await request(app).get('/counters/boom');
    await request(app).post('/counters/boom/increment');
    await request(app).post('/counters/boom/decrement').send({ by: 2 });
    const spans = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(spans.map((s) => [s.name, s.status.code])).toEqual([
      ['POST /counters', 'ERROR'],
      ['GET /counters/:name', 'ERROR'],
      ['POST /counters/:name/increment', 'ERROR'],
      ['POST /counters/:name/decrement', 'ERROR'],
    ]);
  });

  it('caps the logged path at 512 characters', async () => {
    const lines: Array<Record<string, unknown>> = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      if (typeof line === 'string' && line.startsWith('{"ts"')) lines.push(JSON.parse(line));
    });
    await request(createApp(sqliteStore(':memory:'))).get(`/${'a'.repeat(4000)}`);
    expect(String(lines[0].path)).toHaveLength(512);
    expect(String(lines[0].path).startsWith('/aaa')).toBe(true);
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
