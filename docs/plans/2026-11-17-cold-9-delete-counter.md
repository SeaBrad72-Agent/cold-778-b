# Plan record — `COLD-9`

| Field | Value |
|-------|-------|
| Row | `COLD-9` — Delete a counter |
| Design of record | `docs/architecture/2026-11-17-delete-counter-design.md` |
| Change class (derived, never self-asserted) | `ordinary` |

## Team

`.kit/model-map.conf` binds no tier (all `unset`), so every seat runs on the session's model.

| seat | tier | concrete model | why |
|---|---|---|---|
| conductor | unset | claude-opus-5-5 (the session) | holds the owner's context and GO |
| builder | unset | claude-opus-5-5 — **conductor** builds | one store method, one route and a transaction wrap, in files the conductor built |
| reviewer | unset | claude-opus-5-5, the `reviewer` seat, a fresh context | builder ≠ reviewer |
| security | unset | claude-opus-5-5, the `security` seat, a fresh context | the default on the built diff; a new destructive write |

## Task list

1. **Store, test-first:** `delete(name)`; the store rows of the design; wrap the bump and its classifying read in `BEGIN IMMEDIATE`; the two-process robustness test. Commit.
2. **Route, test-first:** `DELETE /counters/:name`, the tripwire, span name, headers, and the cross-site DELETE row. Commit.
3. **README** example; the full local gate. Commit.
4. Push, PR, both seats in parallel from `git archive` exports (no checkout in the shared checkout).
5. Fix and re-review until the reviewer APPROVEs and security PASSes, with or without notes; review record as the final head with all four trailers.
6. Owner's Approve and GO; `record` + `actuate`; then pick up the next card.

## Ceremony budget

Ordinary, size S: short design doc with a one-line lens summary, this plan, the reviewer and security seats, a review record, the owner's Approve, and the four `Kit-*` trailers on the head commit.

## Verification plan

Before the push: lint, type-check, `npm run test:coverage` (each contract row and control has a test seen failing first where the behaviour is new; ≥80%), build. A green proves the contract and robustness under concurrent delete. It does not prove the transaction's consistency, which is guaranteed by construction and verified by reading (design §Honest ceiling).
