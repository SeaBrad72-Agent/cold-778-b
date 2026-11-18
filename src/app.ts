// The Express app factory (COLD-2 design §4). createApp(store) builds the app with the scaffold's
// per-request telemetry (request id, structured log line, OTel-semantic span, Prometheus counters) and
// security headers, the scaffold's routes (/healthz, /metrics, /greeting), and a JSON 404/error tail.
// server.ts is the entrypoint that opens the real store and listens; tests pass a ':memory:' store.
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import querystring from 'node:querystring';
import { health } from './health.js';
import { isEnabled } from './flags.js';
import type { CounterStore } from './store.js';
import { countersRouter } from './counters.js';
import { routeName } from './route-name.js';
import { LOOPBACK_HOSTS } from './config.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'",
  'Referrer-Policy': 'no-referrer',
} as const;

const SERVICE = process.env.SERVICE_NAME ?? 'tally';

// Structured JSON logging to stdout — one machine-parseable line per event (DEVELOPMENT-STANDARDS.md §3).
// Never log request bodies, headers, or any PII/secret — only routing + timing metadata. `path` is the
// full original URL INCLUDING any query string; no route here carries secrets in the query.
function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', service: SERVICE, ...fields }));
}

// One OTel-semantic span per request in the scripts/otel-trace.sh schema. Sink: OTEL_TRACE_FILE if set,
// else stdout. `name` strips the query string (span cardinality + secret hygiene).
function emitSpan(span: Record<string, unknown>): void {
  const line = JSON.stringify(span);
  const sink = process.env.OTEL_TRACE_FILE;
  if (sink) appendFileSync(sink, line + '\n');
  else console.log(line);
}

// Zero-dep Prometheus text exposition, keyed by BOUNDED labels (method, status — never path).
const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

interface Metrics {
  record(method: string | undefined, status: number, latencyMs: number): void;
  render(): string;
}

function createMetrics(): Metrics {
  const requestsTotal = new Map<string, number>(); // key: `${methodLabel}|${status}`
  let durationSecondsTotal = 0;
  return {
    record(method, status, latencyMs) {
      const m = method && KNOWN_METHODS.has(method) ? method : 'other';
      const key = `${m}|${status}`;
      requestsTotal.set(key, (requestsTotal.get(key) ?? 0) + 1);
      durationSecondsTotal += latencyMs / 1000;
    },
    render() {
      const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const lines = [
        '# HELP http_requests_total Total number of HTTP requests handled.',
        '# TYPE http_requests_total counter',
      ];
      for (const [key, count] of requestsTotal) {
        const [method, status] = key.split('|');
        lines.push(`http_requests_total{method="${esc(method)}",status="${esc(status)}"} ${count}`);
      }
      lines.push(
        '# HELP http_request_duration_seconds_total Total accumulated request duration in seconds.',
        '# TYPE http_request_duration_seconds_total counter',
        `http_request_duration_seconds_total ${durationSecondsTotal}`,
      );
      return lines.join('\n') + '\n';
    },
  };
}

const MAX_LOGGED_PATH = 512;

// Span name: the fixed template recorded by routeName() (src/route-name.ts), else `unmatched`.
function routeTemplate(res: Response): string {
  return typeof res.locals.route === 'string' ? res.locals.route : 'unmatched';
}

function telemetry(metrics: Metrics): RequestHandler {
  return (req, res, next) => {
    const startMono = process.hrtime.bigint();
    const startNano = BigInt(Date.now()) * 1_000_000n;
    // Honor an inbound correlation id ONLY if it is a safe, bounded token; otherwise mint one.
    const raw = req.get('x-request-id');
    const requestId = raw && /^[A-Za-z0-9._-]{1,128}$/.test(raw) ? raw : randomUUID();
    // The logged path is attacker-chosen (any URL up to Node's header limit): cap it.
    const path = req.originalUrl.slice(0, MAX_LOGGED_PATH);
    res.locals.requestId = requestId; // read by the error tail, so its ERROR line correlates

    res.set(SECURITY_HEADERS);
    res.on('finish', () => {
      const endMono = process.hrtime.bigint();
      const latencyMs = Math.round((Number(endMono - startMono) / 1e6) * 1000) / 1000;
      log({
        level: res.statusCode >= 500 ? 'error' : 'info',
        requestId,
        method: req.method,
        path,
        status: res.statusCode,
        latencyMs,
      });
      metrics.record(req.method, res.statusCode, latencyMs);
      emitSpan({
        trace_id: randomBytes(16).toString('hex'),
        span_id: randomBytes(8).toString('hex'),
        parent_span_id: null,
        name: `${req.method} ${routeTemplate(res)}`,
        start_unix_nano: startNano.toString(),
        end_unix_nano: (startNano + (endMono - startMono)).toString(),
        attributes: {
          'http.request.method': req.method,
          'http.response.status_code': String(res.statusCode),
          request_id: requestId,
        },
        status: { code: res.statusCode >= 500 ? 'ERROR' : 'OK' },
      });
    });
    next();
  };
}

// The JSON error tail. A request-side error (body-parser, router) carries its own 4xx status; its
// message is chosen from what went wrong, and says nothing about the server. Anything else is a 500:
// the client gets no detail, and the cause goes to the server log as one ERROR line.
function clientMessage(status: number, type: unknown): string {
  if (type === 'entity.parse.failed') return 'request body is not valid JSON';
  if (type === 'entity.too.large' || status === 413) return 'request body too large';
  if (status === 415) return 'unsupported content type or encoding';
  return 'bad request';
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  void _next;
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    log({
      level: 'error',
      event: 'unhandled_error',
      requestId: res.locals.requestId,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'internal error' });
    return;
  }
  res.status(status).json({ error: clientMessage(status, err?.type) });
};

// Cross-site write refusal (COLD-6 security M1; owner decision 2026-11-17). The write API has no login
// (charter), so a page a person visits must not be able to drive it through their browser: a no-body
// POST is a "simple" request a browser sends cross-site without asking first. Browsers mark such
// requests (Sec-Fetch-Site, Origin); curl and scripts send neither header and are unaffected.
// An Origin must also be a LOOPBACK name equal to Host: DNS rebinding makes Origin and Host both read
// `evil.example`, so "Origin equals Host" alone would let it through.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// The one loopback list (src/config.ts), shared with the Host allowlist so the two controls cannot drift.
const LOOPBACK_HOSTNAMES = new Set<string>(LOOPBACK_HOSTS);

function isCrossSiteWrite(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  // Refuse unless known: only absent (curl, scripts), `same-origin` and `none` (typed by the user) pass.
  const site = req.get('sec-fetch-site');
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.get('origin');
  if (origin === undefined) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return true; // `null` (a sandboxed or opaque origin) and anything unparseable
  }
  return !LOOPBACK_HOSTNAMES.has(url.hostname) || url.host !== req.get('host');
}

const refuseCrossSiteWrites: RequestHandler = (req, res, next) => {
  if (isCrossSiteWrite(req)) {
    res.locals.route = 'cross-site-refused'; // a fixed span name, so refusals are findable in traces
    res.status(403).json({ error: 'cross-site request refused' });
    return;
  }
  next();
};

// Host allowlist (COLD-7). A Host header is `hostname[:port]` and nothing else. It is parsed strictly
// rather than through a URL parser, which would "normalise" shapes such as `evil@localhost` into an
// allowed name; anything outside the grammar is refused.
const HOST_HEADER = /^(?:([a-z0-9.-]+)|(\[[0-9a-f:.]+\]))(?::\d{1,5})?$/;

function hostnameOf(header: string | undefined): string | undefined {
  const m = header === undefined ? null : HOST_HEADER.exec(header.toLowerCase());
  return m ? (m[1] ?? m[2]) : undefined;
}

// Exactly one Host field (RFC 9112 §3.2; Node keeps only the first of several), and an origin-form
// target (`/path`). An absolute-form target (`http://other/path`) carries an authority that overrides
// Host (RFC 9112 §3.2.2), so it is refused rather than half-checked; `*` is allowed for OPTIONS only.
function hostFieldCount(rawHeaders: string[]): number {
  let n = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) if (rawHeaders[i].toLowerCase() === 'host') n++;
  return n;
}

function refuseUnknownHosts(allowed: readonly string[]): RequestHandler {
  const set = new Set(allowed.map((h) => h.toLowerCase()));
  return (req, res, next) => {
    const host = hostnameOf(req.headers.host);
    const target = req.originalUrl;
    const originForm = target.startsWith('/') || (target === '*' && req.method === 'OPTIONS');
    if (host === undefined || !set.has(host) || hostFieldCount(req.rawHeaders) !== 1 || !originForm) {
      res.locals.route = 'host-refused'; // a fixed span name, so refusals are findable in traces
      res.status(421).json({ error: 'host not allowed' });
      return;
    }
    next();
  };
}

export interface AppOptions {
  /** Hosts the Host header may name (lowercase; IPv6 in brackets). Default: the loopback names only. */
  allowedHosts?: readonly string[];
}

export function createApp(store: CounterStore, options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  // Parse the query with no key cap. Node's default keeps only the first 1000 pairs and silently drops
  // the rest, so `?&&&…&limit=5000` would slip a parameter past the strict list schema (COLD-8
  // security L1). Node's 16 kB header limit still bounds the query.
  app.set('query parser', (s: string) => querystring.parse(s, '&', '=', { maxKeys: 0 }));
  const metrics = createMetrics();
  app.use(telemetry(metrics));
  app.use(refuseUnknownHosts(options.allowedHosts ?? LOOPBACK_HOSTS));
  app.use(refuseCrossSiteWrites);

  app.get('/healthz', routeName('/healthz'), (_req, res) => {
    res.json(health());
  });
  app.get('/metrics', routeName('/metrics'), (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.end(metrics.render());
  });
  app.get('/greeting', routeName('/greeting'), (_req, res) => {
    res.json({ greeting: isEnabled('newGreeting') ? 'Hello, world! (new)' : 'Hello, world!' });
  });
  app.use('/counters', countersRouter(store));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });
  app.use(errorHandler);
  return app;
}
