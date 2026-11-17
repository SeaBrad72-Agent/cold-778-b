# Plan record — `COLD-6`

| Field | Value |
|-------|-------|
| Row | `COLD-6` — Increment and decrement a named counter |
| Design of record | `docs/architecture/2026-11-17-increment-decrement-design.md` |
| Change class (derived, never self-asserted) | `ordinary` |

## Team

`.kit/model-map.conf` binds no tier (all `unset`), so every seat runs on the session's model.

| seat | tier | concrete model | why |
|---|---|---|---|
| conductor | unset | claude-opus-5-5 (the session) | holds the owner's context and GO |
| builder | unset | claude-opus-5-5 — **conductor** builds | two methods and two routes in files the conductor just built; a hand-off adds nothing |
| reviewer | unset | claude-opus-5-5, the `reviewer` seat, a fresh context | builder ≠ reviewer |
| security | unset | claude-opus-5-5, the `security` seat, a fresh context | the default on the built diff (`skills/review/SKILL.md:39`); a new unauthenticated write |

## Task list

1. **Store, test-first:** `increment`/`decrement` with the guarded single statement, `CounterNotFoundError` and `CounterBoundError`; tests for each store row of the design, including the two-connection no-lost-update test. Commit.
2. **Routes, test-first:** both routes with the `by` schema, the tripwire store, span names and headers. Commit.
3. **README:** add the two `curl` examples. Run the full local gate (`npm run lint`, `npm run type-check`, `npm run test:coverage`, `npm run build`). Commit.
4. Push; open the PR.
5. Dispatch the reviewer and security seats in parallel on the head; record the rounds in `docs/reviews/2026-11-17-cold-6-increment-decrement.md`; fix and re-review until the reviewer APPROVEs and security PASSes, with or without notes.
6. Ask the owner for the forge Approve and the GO; `record` + `actuate`.

## Ceremony budget

Ordinary, size S: short design doc with a one-line lens summary, this plan, the reviewer seat and the security seat, a review record, the owner's Approve, and the `Kit-Row`/`Kit-Class`/`Kit-Plan`/`Kit-Review` trailers on the head commit.

## Verification plan

Before the push: lint, type-check, `npm run test:coverage` (every contract row and each design-promised control has a test that was seen failing first; coverage ≥80%), build. A green proves the contract and, through a rendezvous two-process test that a read-then-write store failed 20 of 20 times (measured), that concurrent bumps lose no update on a local file. It is a timing-based detector, not a proof, and it says nothing about a network filesystem (design §Honest ceiling). CI re-runs the same gates plus the kit's required contexts.
