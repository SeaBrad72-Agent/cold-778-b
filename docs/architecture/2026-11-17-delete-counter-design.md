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
- **Carried COLD-6 fix:** `increment`/`decrement` run the guarded `UPDATE … RETURNING` and, when it returns no row, the classifying `SELECT`, inside one `BEGIN IMMEDIATE … COMMIT` (rolled back on any error). No other connection can create or delete the row between the two statements, so the refusal reported is the refusal the UPDATE met. A contended `BEGIN IMMEDIATE` or `COMMIT` waits up to `busy_timeout` and then **throws**. SQLite's busy wait is not fair, so a rare wait can time out under sustained contention.
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
| A bump's refusal is named from the state its UPDATE met (one transaction) | `test/store.test.ts::an increment on a deleted counter is reported not found even if it is re-created mid-bump` |
| A bump never reports success for a write that did not commit | `test/store.test.ts::a bump whose commit is blocked by a reader fails loudly and changes nothing` |

## Lens review (S, one line)

lenses: no findings except **security**: a new unauthenticated, destructive write. It inherits the name allowlist, the cross-site write guard (403, and browsers preflight a cross-site DELETE), and the loopback default; rate limiting is COLD-4. **Product**: the owner allowed deleting a non-zero counter.

## Honest ceiling

- **What the tests prove (revised in review; the first version of this section was wrong).** The transaction is pinned by three deterministic tests, and each one **fails** against the pre-transaction code (measured):
  - **Two race tests.** A test-only hook (`betweenUpdateAndClassify`, never set by `server.ts`) runs another connection's write exactly between the UPDATE and the classifying read. With the transaction, that write is blocked. Without it, an increment on a counter re-created mid-bump is misreported as "would exceed the maximum" at 0, and a decrement at 0 on a counter deleted mid-bump is misreported as "not found".
  - **A lost-write test.** A reader holds a shared lock. Without the transaction, the auto-commit's busy failure was swallowed and the bump answered success for a write that was never stored (security L2, found on `main`).
- **The hook is a test seam in production code.** It is an option no production caller sets, documented as test-only. It is a deliberate trade for a deterministic test over a timing-based one.
- **Not proven:** behaviour across processes beyond these single-window races, and SQLite's busy-wait fairness. Under sustained writes from another process, roughly 1 lock wait in 20,000 times out after `busy_timeout` and answers 500 (measured in review; the same rate as on `main`, so not a regression).
- There is no undo or soft delete: a deleted counter's value is lost.

## Amendment log

- 2026-11-17: initial design, GO'd by the owner.
- 2026-11-17, review round 1 (reviewer NEEDS-FIXES; security PASS-WITH-NOTES). **A new test seam**, recorded as a design revision:
  - **Reviewer I1:** the two-process "robustness" test never had a bump meet a deleted counter (0 of 5,000 not-found, measured by the seat). The Honest ceiling's "both answers are plausible" was false for increment. A first rework that paced the processes was **still flaky** under CPU contention (2 of 20 runs failed, trials of up to 36 s, measured). Both timing-based race tests and their helper modes were removed and replaced by the deterministic hook tests above.
  - **Security L2:** on `main`, a bump whose auto-commit hit `SQLITE_BUSY` answered success while the value never changed. The transaction fixes it, and a regression test now pins it. `sqliteStore` gains a `busyTimeoutMs` option (default 5000) so the test stays fast.
  - **Security L1:** the README now warns that opening the port lets anyone change or delete counters, with no undo. **Security L3:** double-encoded names were added to the invalid-name table.
  - **Reviewer minors:** the rollback test's comment names the measured failure (m1); the busy-wait wording is corrected (m2); the COLD-6 design is amended (m3); there are span tests for DELETE 204, 404 and 400 (m4); and there is an allowed same-origin DELETE row (m5).
