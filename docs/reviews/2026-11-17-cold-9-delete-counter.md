# Review Record — `COLD-9`

| Field | Value |
|-------|-------|
| Change / PR | #4 — COLD-9, delete a counter |
| Risk tier | `default` — trigger: none (ordinary class; no control-plane, auth, schema migration, deploy or money surface) |
| Builder | conductor (the main session, claude-opus-5-5) |
| Independent review by | the kit's `reviewer` seat and a separate `security` seat, each a fresh context at round 1 — findings recorded below |

---

Builder: conductor (main session, claude-opus-5-5)
Reviewer: reviewer seat (agents/reviewer.agent.md, fresh context, claude-opus-5-5)

## Rounds

| commit | reviewer seat (role first) | verdict (APPROVE\|NEEDS-FIXES) | findings (n) |
|---|---|---|---|
| 4af12ca | reviewer, round 1 | NEEDS-FIXES | 6 |
| e2f5f28 | reviewer, round 2 | APPROVE | 3 |

## Findings

| id | file:line | severity | disposition |
|---|---|---|---|
| R1-I1 — the concurrency test never had a bump meet a deleted counter (0 of 5000 not-found); "both answers plausible" false for increment | test/store.test.ts:258 | Important | fixed e2f5f28 — timing-based tests removed (a paced rework was still 2/20 flaky, measured); deterministic hook tests fail without the transaction |
| R1-m1 — the rollback test's comment named the wrong failure | test/store.test.ts:251 | Minor | fixed e2f5f28 |
| R1-m2 — "busy_timeout makes BEGIN wait rather than fail" overstated | src/store.ts:92 | Minor | fixed e2f5f28 |
| R1-m3 — the COLD-6 design still showed the classifying window as open | docs/architecture/2026-11-17-increment-decrement-design.md:54 | Minor | fixed e2f5f28 |
| R1-m4 — no span test for the DELETE 204 | test/app.test.ts:199 | Minor | fixed e2f5f28 |
| R1-m5 — no allowed (same-origin) DELETE row | test/app.test.ts:56 | Minor | fixed e2f5f28 |
| R2-n1 — IMMEDIATE (rather than a deferred BEGIN) is not pinned by a test | src/store.ts:119 | Minor | accepted — the reviewer measured a deferred BEGIN as still consistent (the UPDATE takes the write lock); IMMEDIATE is kept to avoid the read-to-write upgrade, by reasoning, not by test |
| R2-n2 — `raced()` can leak a connection when an assertion fails | test/store.test.ts:288 | Minor | accepted — test-only; leaks only on an already-failing run, in a temp directory removed by afterEach |
| R2-n3 — `busyTimeoutMs` accepts very large integers | src/store.ts:88 | Minor | accepted — only code can set it (no input or env reaches it); the security seat judged it not a finding |
| S1-L1 — the README did not warn that an open port lets anyone delete counters | README.md:41 | Low | fixed e2f5f28 |
| S1-L2 — on main, a bump's busy auto-commit was swallowed and success reported for an unstored write | src/store.ts:99 | Low | fixed 66c04f0 (the transaction) — regression test added e2f5f28 |
| S1-L3 — no double-encoding row in the invalid-name table | test/counters.test.ts:381 | Low | fixed e2f5f28 |

## Design-promised controls

| control (from the design) | discharged by |
|---|---|
| A deleted counter is gone from read and list | `test/store.test.ts::deletes an existing counter and it is gone from get and list` |
| An invalid name never reaches storage on DELETE | `test/counters.test.ts::never calls the store for an invalid delete` |
| A cross-site browser delete is refused | `test/app.test.ts::refuses a cross-site write with 403 and changes nothing` |
| A bump's refusal is named from the state its UPDATE met | `test/store.test.ts::an increment on a deleted counter is reported not found even if it is re-created mid-bump` |
| A bump never reports success for a write that did not commit | `test/store.test.ts::a bump whose commit is blocked by a reader fails loudly and changes nothing` |

## Security review

ran — seat security, verdict: PASS

| round | commit | seat | verdict | findings (n) |
|---|---|---|---|---|
| 1 | 4af12ca | security | PASS-WITH-NOTES | 3 (S1-L1, S1-L2, S1-L3) |
| 2 | e2f5f28 | security | PASS | 0 |

Threat model / privacy review: not triggered (no personal data). Deletion is irreversible and unauthenticated (charter); it is bounded by the loopback default and the cross-site write guard, and carried on COLD-4 (rate limit) and COLD-7 (Host allowlist).

**Limit of this evidence:** the security seat's sandbox blocked port binding, so it ran the store suite and in-process HTTP probes rather than the route test files. The full suite ran green for the builder and the reviewer (265/265), and runs in CI on this head.

## Task status

| task (from the plan) | state (`done` \| `pending`) | commit |
|---|---|---|
| 1. Store, test-first | done | 66c04f0 |
| 2. Route, test-first | done | 4af12ca |
| 3. README and the full local gate | done | 4af12ca |
| 4. Push, PR, seats | done | #4 |
| 5. Fix and re-review | done | e2f5f28 |
| 6. Owner's Approve and GO; record + actuate; next card | pending | — |

---

## Agent-review findings

- **Reviewer seat:** NEEDS-FIXES, then APPROVE. Its instrumented helper showed the original race test never exercised a delete. In round 2 it re-ran the no-transaction mutant (3 failures), deferred-BEGIN, no-ROLLBACK and hook-always mutants, and probed L2's twins (`create` and `delete` surface busy errors correctly).
- **Security seat:** PASS-WITH-NOTES, then PASS. It found the lost-write bug on `main` (L2) by holding a reader lock, which disproved the builder's first honest ceiling. It judged the test-only hook unreachable from production and inert when unset.
- **Builder's measurements:** two timing-based race designs both measured flaky under load (0 not-found in vitest; 2/20 failures, trials up to 36 s), which led to the deterministic hook. Rollback and name-check mutations each failed their tests.

## Human ratification
- **Ratified by:** owed — @SeaBrad72, by a non-author Approve on PR #4's head
- **Date:** owed
- **Disposition:** findings addressed; three accepted with reason (R2-n1, R2-n2, R2-n3)
