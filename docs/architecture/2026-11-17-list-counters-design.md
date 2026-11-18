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
| A response is bounded (at most 1000 counters) | `test/counters.test.ts::rejects an invalid query with 400` (its `limit 1001` row; proven by raising the cap, which failed it) |
| Paging returns every counter exactly once | `test/store.test.ts::walking every page returns every counter once` |
| An invalid query never reaches storage | `test/counters.test.ts::never calls the store for an invalid list query` |

## Lens review (S, one line)

lenses: no findings except **security**: a new read of every counter name and value. Same exposure class as `GET /counters/:name`: no personal data, reads exempt from the write guard by design, and DNS-rebinding reads are carried as COLD-7. **Cost**: responses bounded at 1000 rows.

## Honest ceiling

Paging is by name, not a snapshot. A counter created or deleted between two page requests may appear or vanish once the walk has passed its position. That is fine for a team's tallies, and it is stated here so no one reads paging as a consistent export.

## Amendment log

- 2026-11-17: initial design, GO'd by the owner.
- 2026-11-17, during the build (no new mechanism): the query is **strict**, so an unknown parameter is refused with 400, not ignored. Express's query parser turns `after[x]=a` into an unknown key, which a lenient schema would silently skip. "Reject by default" applies; a cache-busting parameter such as `?_=123` is refused too. The bounded-response control is discharged by the invalid-query test's `limit 1001` row, not the paging test this design first named.
- 2026-11-17, review round 1 (reviewer APPROVE with 3 Minors; security PASS-WITH-NOTES):
  - **The app's query parser has no key cap** (security L1). Node's default kept only the first 1,000 pairs, so `?&&&…&limit=5000` slipped past the strict schema. It applies to every route, and Node's 16 kB header limit still bounds the query.
  - A repeated `after` now says `after must be a single counter name` (reviewer m2). `store.list` throws a RangeError for a `limit` that is not an integer ≥ 1, because SQLite reads a negative LIMIT as "no limit" (reviewer m1).
  - Negative tests were added for every attack shape the security seat listed (L2) and for an empty `after` (reviewer m3).
  - **Carried, made worse here** (security M1): with the list, a DNS-rebound page can read the whole table, not only names it guesses. COLD-7 (Host allowlist) records this and is now first on the board.
