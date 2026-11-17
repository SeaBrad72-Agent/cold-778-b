# Design — create and read a named counter

| Field | Value |
|---|---|
| Backlog item | `COLD-2` (Jira, space COLD) — "Create and read a named counter" |
| Provenance | P1, authored in this slice |
| Change class | `ordinary` (derived: `conformance/promotion-readiness.sh --class --changed <listing>`) |
| Size | M |
| Owner GO | @SeaBrad72, 2026-11-17, in session, on the design presented in chat (this file records it) |
| Decisions searched | `docs/governance/DECISIONS.md` §4: no ruling on this surface |

## 1. Problem and outcome

The charter (`CLAUDE.md` §1): small teams lose simple counts kept in spreadsheets and chat. This slice delivers the first observable behaviour: a team member can create a named counter and read it back over HTTP, and the counter survives a restart. Increment, decrement, list and delete are later slices.

## 2. Behaviour (the contract)

| Request | Outcome |
|---|---|
| `POST /counters` body `{"name": "<name>"}`, name valid and new | **201** `{"name": "<name>", "value": 0}` |
| `POST /counters`, name valid but already exists | **409** `{"error": "counter already exists"}`; the stored value is unchanged |
| `POST /counters`, body missing, not JSON, not an object, `name` missing or invalid | **400** `{"error": "<reason>"}`; nothing is stored |
| `GET /counters/<name>`, exists | **200** `{"name": "<name>", "value": <int>}` |
| `GET /counters/<name>`, valid but unknown | **404** `{"error": "counter not found"}` |
| `GET /counters/<name>`, invalid name | **400** `{"error": "<reason>"}` |
| `GET /healthz`, `GET /metrics`, `GET /greeting` | unchanged from the scaffold |
| anything else | **404** `{"error": "not found"}` (unchanged) |

**Name rule:** `^[a-z0-9][a-z0-9-]{0,63}$`, which is 1–64 characters of lowercase letters, digits and hyphens, not starting with a hyphen. Names are case-sensitive as stored; an uppercase name is invalid rather than silently lowercased, so a script never reads a different counter from the one it wrote.

**Body limit:** JSON bodies over 1 kB are refused with **413**. A name is at most 64 bytes.

## 3. Approaches considered

1. **Express 5 + Zod + `node:sqlite` (chosen).** It follows ADR-000. The built-in `node:sqlite` (Node 24, no flag, measured locally: `v24.22.1`) needs no native build step in CI.
2. **Keep `node:http` and hand-roll routing.** This adds no dependencies, but every later slice re-implements routing, JSON body parsing and limits, and ADR-000 already chose Express.
3. **`better-sqlite3` instead of `node:sqlite`.** It is more mature, but it is a native add-on, compiled or downloaded per platform in CI. For one small table, the built-in module is enough. Revisit if `node:sqlite` proves unstable.

## 4. Shape

- `src/store.ts` defines a `CounterStore` interface (`create(name)`, `get(name)`) and `sqliteStore(path)`, which opens the database, creates the table if it does not exist, and returns the store. The table is `counters(name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`. Every statement is prepared and parameterised, and no SQL is built from input. A duplicate `create` is detected by the primary-key constraint, not by a read-then-write.
- `src/counters.ts` holds the Zod name schema and an Express router mounting the two routes on a store passed in.
- `src/app.ts` provides `createApp(store)`. It builds the Express app, moves the scaffold's middleware (request id, structured log line, OTel span, metrics, security headers) and its routes (`/healthz`, `/metrics`, `/greeting`) onto it, mounts the counters router, and handles 404 and JSON errors. `x-powered-by` is disabled.
- `src/server.ts` becomes the entrypoint only. It reads `TALLY_DB_PATH` (default `./data/tally.db`, with its directory created if missing) and `PORT`, then listens. It stays excluded from coverage, as in the scaffold.

## 5. Test plan (TDD: red first)

- `test/store.test.ts`: create then get returns 0; a duplicate create throws `CounterExistsError` and leaves the value unchanged; get of an unknown name returns `undefined`; **restart**: create in a file database, close, reopen the same path, and get still returns the counter.
- `test/counters.test.ts` (supertest against `createApp(sqliteStore(':memory:'))`): every row of §2's table, each invalid-name class (empty, 65 characters, uppercase, leading hyphen, space, slash, non-string, missing body, non-JSON body), 413 on an oversize body, and the security headers on a counters response.
- `test/integration.test.ts` and `test/health.test.ts` are kept and re-pointed at `createApp`, so `/healthz`, `/metrics` and `/greeting` are proven unchanged.
- Coverage stays ≥80% (the CI gate).

## Design-promised controls

| Control | Discharging test |
|---|---|
| An invalid name is refused before any storage call | `test/counters.test.ts::rejects invalid names with 400 and stores nothing` |
| SQL is parameterised (input never reaches SQL text) | `test/store.test.ts::stores a name containing SQL metacharacters verbatim` (the route refuses such a name; the store test proves the store is safe on its own) |
| Oversize bodies are refused | `test/counters.test.ts::refuses a body over 1kb with 413` |
| A duplicate create never resets a value | `test/store.test.ts::duplicate create throws and keeps the value` |

## Lens review

| # | Lens | Finding |
|---|---|---|
| 1 | Project principles | Holds the charter's scope (API, simple storage, validation, health) and the success bar (tests, ≥80%, green CI). ADR-000's stack is followed, with the driver choice it left open made here (`node:sqlite`). |
| 2 | Friction | Gains: a team can create and read counters. Pays: three runtime dependencies (express, zod) plus dev dependencies (supertest, types) to keep patched; the dependency scan in CI covers them. |
| 3 | Software practice | Router + store interface + app factory is the standard Express testable layout; the alternative (one file) is harder to test without binding a port. |
| 4 | Agentic practice | A later slice reads `store.ts` and `counters.ts` only, and adds one method and one route each. Every behaviour claim is checkable by a test the agent runs; none is trusted. |
| 5 | CI | No service container (SQLite is in process). Estimate: +5–15 s of install and test time on a run of about 5.5 min (measured, run 44152584096). No new flake surface: no network, and `:memory:` databases per test. |
| 6 | DevOps and operations | Deploy is out of scope. Rollback is reverting the merge. Signal: `/healthz` and the existing structured request log and metrics, unchanged. The data file location is `TALLY_DB_PATH`. |
| 7 | Security, privacy and guardrails | No agent gains a capability. The data is counter names and integers, with no personal data. There is no auth, by charter (accounts are out of scope), so anyone who can reach the port can create counters; this is accepted for this slice because deploy is out of scope. Controls: name allowlist, parameterised SQL, 1 kB body limit, security headers kept, `x-powered-by` off. Threat model / privacy review / evals: not triggered. Compliance: none. |
| 8 | Cost and efficiency | Ships in this project (adopter code, not kit). Size M, by about 300–450 lines including tests (estimate). Runtime cost: none beyond a local file. |
| 9 | Product | Need: the charter's core use. Metric: a counter can be created and read back over HTTP and survives a restart (the COLD-2 metric). |
| 10 | Design | Smaller shape considered: an in-memory store on `node:http`. It falls short because it loses counts on restart (the charter's problem) and is replaced by the next slice. |
| 11 | Architecture | Seams: the scaffold's flags seam and telemetry are kept intact; the store interface is the new seam for storage. No kit contract is touched. |
| 12 | UX and accessibility | The user is a script or a browser hitting JSON endpoints. Every error is a JSON object with a one-line `error`, with status codes per §2. No UI, so WCAG is N/A. |

## Honest ceiling

Tests prove the contract in §2 against an in-memory database and a file database in the test process. They do not prove behaviour under concurrent writers across processes (out of scope at this size), or on any deployed host.

## Amendment log

- 2026-11-17: initial design, GO'd by the owner.
- 2026-11-17, review round 1 (no new mechanism, variable or gate; behaviour notes only):
  - Request-side errors answer with a message that names the cause: `request body is not valid JSON`, `request body too large`, `unsupported content type or encoding` (415), or `bad request` (for example, a malformed percent-encoding in the URL). A 500 writes one `level: "error"` line with the cause to the server log, and never to the client.
  - "Unchanged" for `/healthz`, `/metrics` and `/greeting` means the same responses at the same paths. Express routing also accepts a trailing slash, a query string and any letter case (`/HEALTHZ`), where the old exact match answered 404. This is accepted as harmless.
  - The default `SERVICE_NAME` in log lines and spans is now `tally` (was `reference-app`).
  - An empty `TALLY_DB_PATH` falls back to `./data/tally.db` instead of opening a temporary database.
- 2026-11-17, security seat (PASS-WITH-NOTES; hardening of existing behaviour, no new mechanism):
  - Spans are named by a fixed route template recorded when the route matches (`GET /counters/:name`, `POST /counters`, or `unmatched`), so error paths keep the right name and no request text reaches a span name. The logged `path` is capped at 512 characters.
  - The server listens on `TALLY_HOST`, default `127.0.0.1` (not `HOST`, which some shells export as the hostname). A container must set `TALLY_HOST=0.0.0.0` (the profile's Dockerfile, when it is adopted).
  - `PORT`, `TALLY_HOST` and `TALLY_DB_PATH` are documented in `README.md`. `.env.example` is carried as **COLD-3**: the agent's permission settings deny reading it.
  - Carried forward, not built here: a cap or rate limit on counter creation, **COLD-4**, owed before the service is reachable from more than one machine (the auth or deploy slice). The baseline toolchain's `npm audit` findings are **COLD-5**.
