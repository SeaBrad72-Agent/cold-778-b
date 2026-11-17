# Plan record — `COLD-8`

| Field | Value |
|-------|-------|
| Row | `COLD-8` — List all counters |
| Design of record | `docs/architecture/2026-11-17-list-counters-design.md` |
| Change class (derived, never self-asserted) | `ordinary` |

## Team

`.kit/model-map.conf` binds no tier (all `unset`), so every seat runs on the session's model.

| seat | tier | concrete model | why |
|---|---|---|---|
| conductor | unset | claude-opus-5-5 (the session) | holds the owner's context and GO |
| builder | unset | claude-opus-5-5 — **conductor** builds | one store method and one route in files the conductor built |
| reviewer | unset | claude-opus-5-5, the `reviewer` seat, a fresh context | builder ≠ reviewer |
| security | unset | claude-opus-5-5, the `security` seat, a fresh context | the default on the built diff |

## Task list

1. **Store, test-first:** `list(after, limit)` with the `limit + 1` query; the store rows of the design's test plan, including the walk-every-page test. Commit.
2. **Route, test-first:** `GET /counters` with the query schema, the tripwire, span name and headers; update the COLD-2 empty-name test (a trailing-slash GET is now the list). Commit.
3. **README** example; full local gate (`npm run lint`, `npm run type-check`, `npm run test:coverage`, `npm run build`). Commit.
4. Push; open the PR. Dispatch the reviewer and security seats in parallel; they review from `git archive` exports, never by checking out in the shared checkout.
5. Fix and re-review until the reviewer APPROVEs and security PASSes, with or without notes; record the rounds in `docs/reviews/2026-11-17-cold-8-list-counters.md`.
6. Owner's Approve and GO; `record` + `actuate`; then pick up the next card.

## Ceremony budget

Ordinary, size S: short design doc with a one-line lens summary, this plan, the reviewer and security seats, a review record, the owner's Approve, and the four `Kit-*` trailers on the head commit.

## Verification plan

Before the push: lint, type-check, `npm run test:coverage` (each contract row and design-promised control has a test that was seen failing first; coverage ≥80%), build. A green proves the contract on one process's view of the table. Paging is not a snapshot (design §Honest ceiling).
