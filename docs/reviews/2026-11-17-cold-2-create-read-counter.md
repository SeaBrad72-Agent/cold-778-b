# Review Record — `COLD-2`

| Field | Value |
|-------|-------|
| Change / PR | #1 — COLD-2, create and read a named counter |
| Risk tier | `default` — trigger: none (ordinary class; no control-plane, auth, schema migration, deploy or money surface) |
| Builder | conductor (the main session, claude-opus-5-5) |
| Independent review by | the kit's `reviewer` seat and a separate `security` seat, each a fresh context — findings recorded below |

---

Builder: conductor (main session, claude-opus-5-5)
Reviewer: reviewer seat (agents/reviewer.agent.md, fresh context, claude-opus-5-5)

## Rounds

| commit | reviewer seat (role first) | verdict (APPROVE\|NEEDS-FIXES) | findings (n) |
|---|---|---|---|
| 0721dad | reviewer, round 1 | NEEDS-FIXES | 7 |
| e3a6591 | reviewer, round 2 | APPROVE | 0 |
| 5653b3c | reviewer, round 3 | NEEDS-FIXES | 3 |
| a817f97 | reviewer, round 4 | APPROVE | 1 |

## Findings

| id | file:line | severity | disposition |
|---|---|---|---|
| R1-I1 — a 500 was swallowed with no ERROR log line | src/app.ts:154 | Important | fixed e3a6591 |
| R1-I2 — misleading 4xx messages (URIError as "not valid JSON"; 415 as "internal error") | src/app.ts:156 | Important | fixed e3a6591 |
| R1-I3 — the plan skipped the separate security seat the review skill makes the default | docs/plans/2026-11-17-cold-2-create-read-counter.md:14 | Important | fixed e3a6591 — security seat dispatched on the built diff; its verdicts are below |
| R1-M1 — empty TALLY_DB_PATH opened a temporary database | src/server.ts:20 | Minor | fixed e3a6591 |
| R1-M2 — Express routing is looser than the old exact match (case, trailing slash, query) | src/app.ts:168 | Minor | accepted — harmless and arguably better; recorded in the design's amendment log |
| R1-M3 — telemetry test gaps (unsafe request id, info log line, headers on a 404) | test/app.test.ts:1 | Minor | fixed e3a6591 |
| R1-M4 — default SERVICE_NAME changed from reference-app to tally | src/app.ts:62 | Minor | accepted — intentional; recorded in the design's amendment log and the PR |
| R3-I1 — span names wrong on error paths (POST /, GET /:name) | src/app.ts:78 | Important | fixed a817f97 |
| R3-M1 — owed items lived only in the amendment log, not on cards | docs/architecture/2026-11-17-create-read-counter-design.md:93 | Minor | fixed a817f97 — carried as COLD-3, COLD-4 and COLD-5 |
| R3-M2 — HOST collides with the hostname csh/tcsh export | src/server.ts:27 | Minor | fixed a817f97 |
| R4-M1 — the /counters prefix is repeated in routeName() and the mount | src/counters.ts:25 | Minor | accepted — a fixed string per route is the point of the fix (no request text); one router, one mount today; revisit if the router is ever mounted elsewhere |
| S1-M1 — the name allowlist and body parsing lacked one negative per attack class; "stores nothing" was a weak assertion | test/counters.test.ts:40 | Medium | fixed 5653b3c |
| S1-L1 — spans and logs carried the raw, uncapped URL | src/app.ts:103 | Low | fixed 5653b3c |
| S1-L2 — listened on all interfaces with an unauthenticated write endpoint | src/server.ts:26 | Low | fixed 5653b3c |
| S1-L3 — TALLY_DB_PATH not in .env.example | src/server.ts:19 | Low | accepted — documented in README.md; .env.example is carried as COLD-3 because the agent's permission settings deny reading it |
| S2-N1 — span names wrong on error paths; URL letter case in span names | src/app.ts:80 | Low | fixed a817f97 |
| S3-L1 — no test covers the loopback default (server.ts is excluded from coverage) | src/server.ts:28 | Low | accepted — carried as COLD-4 (listenHost(env) plus four tests); the security seat confirmed the default by code reading, and noted that it needs no further security pass |

## Design-promised controls

| control (from the design) | discharged by |
|---|---|
| An invalid name is refused before any storage call | `test/counters.test.ts::never calls the store for an invalid name` |
| SQL is parameterised (input never reaches SQL text) | `test/store.test.ts::stores a name containing SQL metacharacters verbatim` |
| Oversize bodies are refused | `test/counters.test.ts::refuses a body over 1kb with 413` |
| A duplicate create never resets a value | `test/store.test.ts::duplicate create throws and keeps the value` |

## Security review

ran — seat security, verdict: PASS-WITH-NOTES

| round | commit | seat | verdict | findings (n) |
|---|---|---|---|---|
| 1 | e3a6591 | security | PASS-WITH-NOTES | 4 (S1-M1, S1-L1, S1-L2, S1-L3) |
| 2 | 5653b3c | security | PASS-WITH-NOTES | 1 (S2-N1) |
| 3 | a817f97 | security | PASS-WITH-NOTES | 1 (S3-L1) |

Threat model / privacy review: not triggered (no personal data; counter names and integers). No authentication, by charter: accepted for this slice, mitigated by the loopback default (`TALLY_HOST`), and a creation cap or rate limit is owed as COLD-4 before the service is reachable from more than one machine.

## Task status

| task (from the plan) | state (`done` \| `pending`) | commit |
|---|---|---|
| 1. Add dependencies | done | a761631 |
| 2. Store, test-first | done | 9485dea |
| 3. App factory, test-first | done | 39615ac |
| 4. Counter routes, test-first | done | 1901f01 |
| 5. Full local gate | done | 0721dad |
| 6. Push and open the PR | done | #1 |
| 7. Reviewer and security rounds until APPROVE | done | a817f97 |
| 8. Owner's forge Approve and GO to merge | pending | — |

---

## Agent-review findings

- **Reviewer seat:** four rounds; the last (a817f97) is APPROVE with one optional Minor (R4-M1, accepted). Each round re-ran `npm test`, `npm run test:coverage`, lint, type-check and build, and probed raw HTTP in-process through a socket pair (no port).
- **Security seat:** three rounds, all PASS-WITH-NOTES, with no Critical or High findings. It ran 32 input and body-parsing probes and 16 span-name probes. It confirmed parameterised SQL, the allowlist (with the `m`-flag mutation catching `abc\n`), no error detail leaked to clients, bounded metrics labels, the headers, the lockfile's registry and integrity, and nothing hardcoded.
- **Both seats independently found R3-I1 / S2-N1**, a defect in the builder's own S1-L1 fix that the builder's success-path-only test had missed.

## Human ratification
- **Ratified by:** owed — @SeaBrad72, by a non-author Approve on PR #1's head
- **Date:** owed
- **Disposition:** findings addressed; four accepted with reason (R1-M2, R1-M4, R4-M1, S1-L3) and one carried (S3-L1 → COLD-4)
