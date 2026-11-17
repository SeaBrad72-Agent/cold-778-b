# Design — list all counters

| Field | Value |
|---|---|
| Backlog item | `COLD-8` (Jira, space COLD) — "List all counters" |
| Provenance | P1, authored in this slice; builds on COLD-2 and COLD-6 |
| Change class | `ordinary` (derived: `conformance/promotion-readiness.sh --class --changed <listing>`) |
| Size | S |
| Owner GO | @SeaBrad72, 2026-11-17, in session, on the design presented in chat, paging included |
| Decisions searched | `docs/governance/DECISIONS.md` §4: no ruling on this surface |

## Contract

| Request | Outcome |
|---|---|
| `GET /counters` | **200** `{"counters": [{"name","value"}, …]}` sorted by name (byte order); `{"counters": []}` when there are none |
| `GET /counters?limit=n` | at most n counters (1–1000; default 100) |
| more counters exist beyond the page | the body also carries `"next": "<last name returned>"` |
| `GET /counters?after=<name>` | counters whose name sorts after `<name>` (the name need not exist) |
| `limit` not a whole number 1–1000; `after` not a valid counter name; either given twice | **400**, a JSON `error` |
| `GET /counters/` (trailing slash) | the same list (Express routing ignores a trailing slash); it was a 404 before this slice |

The list is a read. The cross-site write guard does not apply. Headers, request id and logs work as on every route, and the span is named `GET /counters`.

## Shape

- `src/store.ts` gains `list(after: string | undefined, limit: number): { counters: Counter[]; next?: string }`: one prepared query, `SELECT name, value FROM counters WHERE name > ? ORDER BY name LIMIT ?`, run with `limit + 1`. The extra row only decides whether `next` is set. `after` absent binds `''`, which every valid name sorts after. The primary key's index serves both the range and the order.
- `src/counters.ts` adds `router.get('/', routeName('/counters'), …)` with a Zod query schema: `limit` must match `^[1-9][0-9]{0,3}$` and be ≤ 1000; `after` reuses the COLD-2 name rule. A repeated parameter (an array in Express's query parser) is refused.

## Test plan (TDD, red first)

- **Store:** empty; sorted order; `limit` caps and sets `next`; the last page has no `next`; `after` continues exactly where `next` left off; `after` a name that does not exist; walking every page returns every counter once.
- **Routes:** each contract row; invalid `limit` classes (0, 1001, -1, 1.5, `abc`, empty, `1e2`, repeated); invalid `after` (uppercase, too long, encoded newline, repeated); span name `GET /counters`; headers; a tripwire store proves an invalid query never reaches storage.

## Design-promised controls

| Control | Discharging test |
|---|---|
| A response is bounded (at most 1000 counters) | `test/counters.test.ts::caps a page at the limit and sets next` |
| Paging returns every counter exactly once | `test/store.test.ts::walking every page returns every counter once` |
| An invalid query never reaches storage | `test/counters.test.ts::never calls the store for an invalid list query` |

## Lens review (S, one line)

lenses: no findings except **security**: a new read of every counter name and value. Same exposure class as `GET /counters/:name`: no personal data, reads exempt from the write guard by design, and DNS-rebinding reads are carried as COLD-7. **Cost**: responses bounded at 1000 rows.

## Honest ceiling

Paging is by name, not a snapshot. A counter created or deleted between two page requests may appear or vanish once the walk has passed its position. That is fine for a team's tallies, and it is stated here so no one reads paging as a consistent export.

## Amendment log

- 2026-11-17: initial design, GO'd by the owner.
