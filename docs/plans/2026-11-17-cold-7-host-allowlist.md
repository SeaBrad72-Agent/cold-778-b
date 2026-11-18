# Plan record — `COLD-7`

| Field | Value |
|-------|-------|
| Row | `COLD-7` — Allowlist the Host header against DNS rebinding |
| Design of record | `docs/architecture/2026-11-17-host-allowlist-design.md` |
| Change class (derived, never self-asserted) | `ordinary` |

## Team

`.kit/model-map.conf` binds no tier (all `unset`), so every seat runs on the session's model.

| seat | tier | concrete model | why |
|---|---|---|---|
| conductor | unset | claude-opus-5-5 (the session) | holds the owner's context and GO |
| builder | unset | claude-opus-5-5 — **conductor** builds | one config module and one middleware in files the conductor built |
| reviewer | unset | claude-opus-5-5, the `reviewer` seat, a fresh context | builder ≠ reviewer |
| security | unset | claude-opus-5-5, the `security` seat, a fresh context | the default on the built diff; a new security control |

## Task list

1. **Config, test-first:** `src/config.ts` (`parseAllowedHosts`, `allowedHostsFrom`, `ConfigError`); `test/config.test.ts`. Commit.
2. **Middleware, test-first:** `refuseUnknownHosts` in `src/app.ts`, the `createApp` option, wiring in `src/server.ts`; tests in `test/app.test.ts`. Commit.
3. **README** (the new setting and the 421); the full local gate. Commit.
4. Push, PR, both seats in parallel from `git archive` exports.
5. Fix and re-review; review record as the final head with all four trailers.
6. Owner's Approve and GO; `record` + `actuate`; then pick up the next card.

## Ceremony budget

Ordinary, size S: short design doc with a one-line lens summary, this plan, the reviewer and security seats, a review record, the owner's Approve, and the four `Kit-*` trailers on the head commit.

## Verification plan

Before the push: lint, type-check, `npm run test:coverage` (each contract row and both controls have a test seen failing first; ≥80%), build. A green proves the Host check and the configuration's fail-closed parsing. It does not prove authentication, which is out of scope (design §Honest ceiling).
