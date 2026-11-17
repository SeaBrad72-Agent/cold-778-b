# Review Record — `COLD-6`

| Field | Value |
|-------|-------|
| Change / PR | #2 — COLD-6, increment and decrement a named counter |
| Risk tier | `default` — trigger: none (ordinary class; no control-plane, auth, schema migration, deploy or money surface) |
| Builder | conductor (the main session, claude-opus-5-5) |
| Independent review by | the kit's `reviewer` seat and a separate `security` seat, each a fresh context at round 1 — findings recorded below |

---

Builder: conductor (main session, claude-opus-5-5)
Reviewer: reviewer seat (agents/reviewer.agent.md, fresh context, claude-opus-5-5)

## Rounds

| commit | reviewer seat (role first) | verdict (APPROVE\|NEEDS-FIXES) | findings (n) |
|---|---|---|---|
| 64a6335 | reviewer, round 1 | NEEDS-FIXES | 4 |
| 9561813 | reviewer, round 2 | NEEDS-FIXES | 4 |
| ba0c7e6 | reviewer, round 3 | APPROVE | 2 |

## Findings

| id | file:line | severity | disposition |
|---|---|---|---|
| R1-I1 — the no-lost-update test was vacuous (a synchronous store never interleaves; a read-then-write mutant passed it) | test/store.test.ts:114 | Important | fixed f0919a2 — replaced by a two-process test (completed by R2-I1) |
| R1-I2 — a null or non-JSON body silently bumped by 1 | src/counters.ts:90 | Important | fixed f0919a2 |
| R1-M1 — the error-classifying read can mislabel 404/409 across processes | src/store.ts:72 | Minor | accepted — it never affects a write; recorded in the design's Honest ceiling for the delete slice |
| R1-M2 — no busy_timeout: contended writes fail with SQLITE_BUSY | src/store.ts:61 | Minor | fixed f0919a2 — measured as a real crash ("database is locked") by the new test before the fix |
| R2-I1 — the two-process barrier was a no-op (the mutant passed 1 run in 10) | test/store.test.ts:140 | Important | fixed ba0c7e6 — ready-file rendezvous; the mutant failed 20/20, measured by the builder and again by the reviewer |
| R2-m1 — refused cross-site writes were traced as "POST unmatched" | src/app.ts:198 | Minor | fixed ba0c7e6 |
| R2-m2 — the Origin/Host compare is case-sensitive and port-literal | src/app.ts:182 | Minor | accepted — every mismatch fails closed; browsers send lowercase and omit default ports |
| R2-m3 — an empty chunked body with no Content-Type gets 415 | src/counters.ts:92 | Minor | accepted — an odd client shape; fails closed |
| R3-m1 — a child that crashes before ready makes the test fail slowly (15 s) | test/helpers/two-process.ts:31 | Minor | accepted — the failure is loud and correct, only slow |
| R3-m2 — the mutant mode is exercised only by hand | test/helpers/bump-many.ts:23 | Minor | accepted — stated in the design's Honest ceiling: a timing-based detector, measured 20/20 |
| S1-M1 — any web page could bump or zero counters with a cross-site POST (CSRF) | src/counters.ts:79 | Medium | fixed 9561813 — owner decision: refuse cross-site browser writes (403), with a loopback-name rule against DNS rebinding |
| S1-L1 — a JSON null body bumped by 1 | src/counters.ts:89 | Low | fixed f0919a2 |
| S1-L2 — the classifying read becomes reachable once delete exists | src/store.ts:72 | Low | accepted — recorded in the design's Honest ceiling; the delete slice must revisit it |
| S1-N — no CHECK constraint on the value column | src/store.ts:62 | Note | accepted — defence in depth only; the API cannot produce a bad value (probed) |
| S2-L3 — Sec-Fetch-Site was refused on two values only, not "refuse unless known" | src/app.ts:172 | Low | fixed ba0c7e6 |
| S2-L4 — no Host allowlist: rebinding for reads and for Origin-less old browsers | src/app.ts:182 | Low | accepted — carried as COLD-7 (Host allowlist) |

## Design-promised controls

| control (from the design) | discharged by |
|---|---|
| A value never goes below zero | `test/store.test.ts::decrement below zero is refused and keeps the value` |
| No lost updates under concurrent bumps | `test/store.test.ts::two processes bumping the same file concurrently lose no update` |
| An invalid name or `by` never reaches storage | `test/counters.test.ts::never calls the store for an invalid bump` |
| The value stays within the safe-integer range | `test/store.test.ts::increment past the maximum is refused and keeps the value` |
| A cross-site browser write never changes a counter | `test/app.test.ts::refuses a cross-site write with 403 and changes nothing` |

## Security review

ran — seat security, verdict: PASS

| round | commit | seat | verdict | findings (n) |
|---|---|---|---|---|
| 1 | 64a6335 | security | PASS-WITH-NOTES | 4 (S1-M1, S1-L1, S1-L2, S1-N) |
| 2 | 9561813 | security | PASS-WITH-NOTES | 2 (S2-L3, S2-L4) |
| 3 | ba0c7e6 | security | PASS | 0 |

Threat model / privacy review: not triggered (no personal data). No authentication, by charter; the loopback default, the cross-site write refusal (this PR) and COLD-7 (Host allowlist, carried) bound who can reach the write API.

## Task status

| task (from the plan) | state (`done` \| `pending`) | commit |
|---|---|---|
| 1. Store, test-first | done | df59b6b |
| 2. Routes, test-first | done | 799a2fe |
| 3. README and the full local gate | done | 64a6335 |
| 4. Push and open the PR | done | #2 |
| 5. Reviewer and security rounds | done | ba0c7e6 |
| 6. Owner's forge Approve and GO; record + actuate | pending | — |

---

## Agent-review findings

- **Reviewer seat:** three rounds; the last (ba0c7e6) APPROVE, with two optional Minors (accepted). Each round re-ran the full gate and probed in-process. Both concurrency defects in the builder's tests came from this seat: a vacuous test, then a barrier that did nothing. Each was proven by running a read-then-write mutant against the builder's own harness.
- **Security seat:** three rounds, ending PASS. It found the cross-site request forgery (owner decision: refuse cross-site browser writes), then ran 30+ bypass probes of the guard over two rounds; none was exploitable from a browser.
- **Builder's own mutation checks:** below-zero guard, `by` minimum, rebinding rule, mutant harness 20/20.

## Human ratification
- **Ratified by:** owed — @SeaBrad72, by a non-author Approve on PR #2's head
- **Date:** owed
- **Disposition:** findings addressed; seven accepted with reason (R1-M1, R2-m2, R2-m3, R3-m1, R3-m2, S1-L2, S1-N) and one carried (S2-L4 → COLD-7)
