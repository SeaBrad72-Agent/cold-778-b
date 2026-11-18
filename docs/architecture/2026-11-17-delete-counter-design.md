# Design — delete a counter

| Field | Value |
|---|---|
| Backlog item | `COLD-9` (Jira, space COLD) — "Delete a counter" |
| Provenance | P1, authored in this slice; builds on COLD-2, COLD-6 and COLD-8 |
| Change class | `ordinary` (derived: `conformance/promotion-readiness.sh --class --changed <listing>`) |
| Size | S |
| Owner GO | @SeaBrad72, 2026-11-17, in session, on the design presented in chat. Deleting a counter is allowed whatever its value (the alternative, refusing a non-zero counter, was offered and not chosen) |
| Decisions searched | `docs/governance/DECISIONS.md` §4: no ruling on this surface |
| Obligation inherited | COLD-6 design, Honest ceiling and amendment log: the classifying read after a refused bump must be revisited once delete exists (COLD-6 reviewer M1, security L2) |

## Contract

| Request | Outcome |
|---|---|
| `DELETE /counters/<name>`, exists | **204**, no body; the counter is gone from `GET /counters/<name>` (404) and from the list |
| `DELETE /counters/<name>`, unknown | **404** `{"error": "counter not found"}` |
| `DELETE /counters/<name>`, invalid name | **400**; the store is not called |
| cross-site browser `DELETE` | **403** `cross-site request refused` (the existing guard: DELETE is not a safe method) |
| a bump racing a delete | 404 when the counter is gone, 409 only when it exists and the bound held, judged in **one transaction** with the bump |

Span name `DELETE /counters/:name`; headers, logs and request id as on every route.

## Shape

- `src/store.ts` gains `delete(name): boolean` (true when a row was removed): one parameterised `DELETE FROM counters WHERE name = ?`.
- **Carried COLD-6 fix:** `increment`/`decrement` run the guarded `UPDATE … RETURNING` and, when it returns no row, the classifying `SELECT`, inside one `BEGIN IMMEDIATE … COMMIT` (rolled back on any error). No other connection can create or delete the row between the two statements, so the refusal reported is the refusal the UPDATE met. `busy_timeout` (COLD-6) makes a contended `BEGIN IMMEDIATE` wait rather than fail.
- `src/counters.ts` adds `router.delete('/:name', routeName('/counters/:name'), …)`: the name rule, then the store, then 204 or 404.

## Test plan (TDD, red first)

- **Store:** delete existing (true; gone from get and list); delete unknown (false); delete twice; delete a non-zero counter; a bump after a delete → `CounterNotFoundError`.
- **Routes:** each contract row; invalid-name classes on DELETE; a tripwire store; the span name on 204 and on the 500 path; headers; the cross-site 403 row added to the existing guard table; a DELETE with a body is ignored (no body semantics).
- **Concurrency (robustness):** one process decrements a counter that is always at 0 while it exists, while another deletes and re-creates it 1,000 times (the COLD-6 rendezvous harness). Every refused decrement must be a 404 or a 409; none may crash, and none may error with `SQLITE_BUSY` or `SQLITE_ERROR`.

## Design-promised controls

| Control | Discharging test |
|---|---|
| A deleted counter is gone from read and list | `test/store.test.ts::deletes an existing counter and it is gone from get and list` |
| An invalid name never reaches storage on DELETE | `test/counters.test.ts::never calls the store for an invalid delete` |
| A cross-site browser delete is refused | `test/app.test.ts::refuses a cross-site write with 403 and changes nothing` (DELETE row) |
| Refused bumps stay well-formed under concurrent delete | `test/store.test.ts::bumps refused during concurrent delete and re-create are clean 404s or 409s` |

## Lens review (S, one line)

lenses: no findings except **security**: a new unauthenticated, destructive write. It inherits the name allowlist, the cross-site write guard (403, and browsers preflight a cross-site DELETE), and the loopback default; rate limiting is COLD-4. **Product**: the owner allowed deleting a non-zero counter.

## Honest ceiling

- **No test can see the transaction's consistency from outside.** During a race, both 404 and 409 are plausible answers. That the error check sees the same state as the UPDATE is guaranteed by construction (one `BEGIN IMMEDIATE` transaction), and the reviewer verifies it by reading the code. The concurrency test proves robustness: no crash and no busy error under contention. It does not prove classification. It would pass against the pre-transaction code too, and this document says so rather than claiming otherwise.
- There is no undo or soft delete: a deleted counter's value is lost.

## Amendment log

- 2026-11-17: initial design, GO'd by the owner.
