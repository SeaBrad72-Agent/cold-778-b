# Review Record — `COLD-8`

| Field | Value |
|-------|-------|
| Change / PR | #3 — COLD-8, list all counters |
| Risk tier | `default` — trigger: none (ordinary class; no control-plane, auth, schema migration, deploy or money surface) |
| Builder | conductor (the main session, claude-opus-5-5) |
| Independent review by | the kit's `reviewer` seat and a separate `security` seat, each a fresh context at round 1 — findings recorded below |

---

Builder: conductor (main session, claude-opus-5-5)
Reviewer: reviewer seat (agents/reviewer.agent.md, fresh context, claude-opus-5-5)

## Rounds

| commit | reviewer seat (role first) | verdict (APPROVE\|NEEDS-FIXES) | findings (n) |
|---|---|---|---|
| a22d951 | reviewer, round 1 | APPROVE | 3 |
| 4152555 | reviewer, round 2 | APPROVE | 1 |

## Findings

| id | file:line | severity | disposition |
|---|---|---|---|
| R1-m1 — store.list did not check its own limit (a negative limit reads as "no limit" in SQLite) | src/store.ts:117 | Minor | fixed 4152555 |
| R1-m2 — a repeated after answered "name must be a string" | src/counters.ts:53 | Minor | fixed 4152555 |
| R1-m3 — no test for an empty after | test/counters.test.ts:394 | Minor | fixed 4152555 |
| R2-m1 — the head commit must carry Kit-Plan and Kit-Review | docs/reviews/2026-11-17-cold-8-list-counters.md:1 | Minor | fixed — this record's commit is the PR head and carries all four trailers |
| S1-M1 — the list widens DNS rebinding to a read of the whole table | src/counters.ts:61 | Medium | accepted — carried as COLD-7 (Host allowlist), whose card was updated with this and ranked first on the board; no personal data, and no auth by charter |
| S1-L1 — Node's 1000-pair cap let later query parameters slip past the strict schema | src/app.ts:202 | Low | fixed 4152555 |
| S1-L2 — negative tests missing for several attack shapes | test/counters.test.ts:392 | Low | fixed 4152555 |
| S2-L3 — the query's size bound is only Node's default 16 kB header limit | src/app.ts:199 | Low | accepted — nothing in the tree raises it (verified by the seat); measured worst-case parse ≈0.4 ms; revisit if a deploy slice ever raises maxHeaderSize |

## Design-promised controls

| control (from the design) | discharged by |
|---|---|
| A response is bounded (at most 1000 counters) | `test/counters.test.ts::rejects an invalid query with 400` |
| Paging returns every counter exactly once | `test/store.test.ts::walking every page returns every counter once` |
| An invalid query never reaches storage | `test/counters.test.ts::never calls the store for an invalid list query` |

## Security review

ran — seat security, verdict: PASS-WITH-NOTES

| round | commit | seat | verdict | findings (n) |
|---|---|---|---|---|
| 1 | a22d951 | security | PASS-WITH-NOTES | 3 (S1-M1, S1-L1, S1-L2) |
| 2 | 4152555 | security | PASS-WITH-NOTES | 2 (S1-M1 carried, S2-L3) |

Threat model / privacy review: not triggered (no personal data). The read exposes nothing beyond the single-name GET except enumeration, which is carried on COLD-7.

**Limit of this evidence:** the security seat could not run the HTTP-level suite in its sandbox (`listen EPERM`, both rounds). It verified routes with in-process probes instead. The full suite ran green locally for the builder and the reviewer (226/226), and runs in CI on this head.

## Task status

| task (from the plan) | state (`done` \| `pending`) | commit |
|---|---|---|
| 1. Store, test-first | done | 76e88d9 |
| 2. Route, test-first | done | a22d951 |
| 3. README and the full local gate | done | a22d951 |
| 4. Push, PR, seats | done | #3 |
| 5. Fix and re-review | done | 4152555 |
| 6. Owner's Approve and GO; record + actuate; next card | pending | — |

---

## Agent-review findings

- **Reviewer seat:** APPROVE in both rounds. In round 2 it compared every existing route through the new parser and through Express's default and found identical results.
- **Security seat:** PASS-WITH-NOTES in both rounds. It found the 1000-pair bypass of the strict query (a real hole in a promise made by the design amendment) and measured the uncapped parser's cost: worst case about 0.4 ms, 1.4 ms end to end.
- **Builder's own mutation checks:** `>` changed to `>=` in the `next` rule, and the 1,000 cap raised. Each failed its test and was restored.

## Human ratification
- **Ratified by:** owed — @SeaBrad72, by a non-author Approve on PR #3's head
- **Date:** owed
- **Disposition:** findings addressed; two accepted with reason (S1-M1 → COLD-7, S2-L3)
