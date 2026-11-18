# Review Record — `COLD-7`

| Field | Value |
|-------|-------|
| Change / PR | #5 — COLD-7, allowlist the Host header against DNS rebinding |
| Risk tier | `default` — trigger: none (ordinary class; a new security control, but no control-plane, auth, schema migration, deploy or money surface) |
| Builder | conductor (the main session, claude-opus-5-5) |
| Independent review by | the kit's `reviewer` seat and a separate `security` seat, each a fresh context at round 1 — findings recorded below |

---

Builder: conductor (main session, claude-opus-5-5)
Reviewer: reviewer seat (agents/reviewer.agent.md, fresh context, claude-opus-5-5)

## Rounds

| commit | reviewer seat (role first) | verdict (APPROVE\|NEEDS-FIXES) | findings (n) |
|---|---|---|---|
| 857c79a | reviewer, round 1 | APPROVE | 3 |
| f68faa4 | reviewer, round 2 | APPROVE | 3 |
| 3c19a00 | reviewer, round 3 | APPROVE | 1 |

## Findings

| id | file:line | severity | disposition |
|---|---|---|---|
| R1-m1 — IPv6 zone-id and non-canonical entries could never match a Host header | src/config.ts:26 | Minor | fixed f68faa4 |
| R1-m2 — all-interfaces binds recognised by spelling only | src/config.ts:11 | Minor | fixed f68faa4 |
| R1-m3 — the loopback list existed twice | src/app.ts:178 | Minor | fixed f68faa4 |
| R2-m1 — the OPTIONS * exception had no test | src/app.ts:222 | Minor | fixed 3c19a00 |
| R2-m2 — README did not say a malformed TALLY_HOST stops startup | README.md:31 | Minor | fixed 3c19a00 |
| R2-m3 — IPv4 entries are not canonicalised (e.g. 192.168.1.020) | src/config.ts:30 | Minor | accepted — fails closed: an unmatched entry only ever answers 421, never widens the list |
| R3-m1 — a TALLY_ALLOWED_HOSTS entry such as 256.1.1.1 is accepted though it can never match | src/config.ts:30 | Minor | accepted — the same fail-closed class as R2-m3 |
| S1-L1 — two Host fields were accepted, first one winning | src/app.ts:210 | Low | fixed f68faa4 |
| S1-L2 — an absolute-form request target's authority was never checked | src/app.ts:210 | Low | fixed f68faa4 |
| S1-L3 — TALLY_HOST was not validated; wildcard spellings missed | src/config.ts:43 | Low | fixed f68faa4 |
| S1-L4 — IPv6 zone ids accepted in config but could never match | src/config.ts:26 | Low | fixed f68faa4 |
| S1-L5 — the new setting is missing from .env.example and RUNBOOK | README.md:31 | Low | accepted — carried as COLD-3 (an owner edit; the agent may not read .env.example), card updated by board.sh edit, proven by post-read |
| S2-LA — some TALLY_HOST values crashed startup with a raw TypeError | src/config.ts:55 | Low | fixed 3c19a00 |
| S2-LB — the asterisk-target branch had no test | src/app.ts:222 | Low | fixed 3c19a00 |

## Design-promised controls

| control (from the design) | discharged by |
|---|---|
| A request with a Host that is not allowed never reaches a route | `test/app.test.ts::refuses a request whose Host is not allowed with 421 and changes nothing` |
| A malformed allowlist stops the server instead of allowing the wrong hosts | `test/config.test.ts::refuses a malformed allowed-hosts entry` |

## Security review

ran — seat security, verdict: PASS-WITH-NOTES

| round | commit | seat | verdict | findings (n) |
|---|---|---|---|---|
| 1 | 857c79a | security | PASS-WITH-NOTES | 5 (S1-L1 … S1-L5) |
| 2 | f68faa4 | security | PASS-WITH-NOTES | 2 (S2-LA, S2-LB) |
| 3 | 3c19a00 | security | PASS-WITH-NOTES | 0 open (notes only: COLD-3 scope unverifiable without network; dead-but-harmless config entries) |

Threat model / privacy review: not triggered. This slice closes the DNS-rebinding gap carried since COLD-6 and widened by COLD-8. It is not authentication (design §Honest ceiling).

## Task status

| task (from the plan) | state (`done` \| `pending`) | commit |
|---|---|---|
| 1. Config, test-first | done | 74ac170 |
| 2. Middleware, test-first | done | 9c7a9f8 |
| 3. README and the full local gate | done | 857c79a |
| 4. Push, PR, seats | done | #5 |
| 5. Fix and re-review | done | 3c19a00 |
| 6. Owner's Approve and GO; record + actuate | pending | — |

---

## Agent-review findings

- **Reviewer seat:** APPROVE in all three rounds. It checked that the config grammar and the Host grammar agree (they did not for IPv6, fixed), that `req.originalUrl` is the raw target, and that nothing legitimate (supertest, e2e, the healthcheck) gets 421.
- **Security seat:** PASS-WITH-NOTES in all three rounds. It sent 63 raw HTTP shapes per round (CONNECT, h2c, duplicate and case-variant Host, absolute-form and asterisk targets), and in round 3 fuzzed both config parsers with 600,000 random inputs: nothing but `ConfigError` was thrown.
- **Builder's mutation check:** a lenient URL-based Host parser let `evil@localhost` and `localhost/x` through, and two tests failed; reverted.

## Human ratification
- **Ratified by:** owed — @SeaBrad72, by a non-author Approve on PR #5's head
- **Date:** owed
- **Disposition:** findings addressed; three accepted with reason (R2-m3, R3-m1, S1-L5 → COLD-3)
