# Plan record — `COLD-2`

| Field | Value |
|-------|-------|
| Row | `COLD-2` — Create and read a named counter |
| Design of record | `docs/architecture/2026-11-17-create-read-counter-design.md` |
| Change class (derived, never self-asserted) | `ordinary` |

## Team

`.kit/model-map.conf` binds no tier (all `unset`, the honest single-model case), so every seat runs on the session's model.

| seat | tier | concrete model | why |
|---|---|---|---|
| conductor | unset | claude-opus-5-5 (the session) | the main session; holds the owner's context and the GO |
| builder | unset | claude-opus-5-5 — **conductor** builds | one small slice, files tightly coupled (app, router, store, server); a separate worktree seat adds a hand-off for no parallelism. Builder line says `conductor` (CLAUDE.md §1 act 5) |
| reviewer | unset | claude-opus-5-5, the `reviewer` seat (`agents/reviewer.agent.md`), a fresh context | builder ≠ reviewer |
| security | — | — | not owed: class `ordinary` |

## Task list

1. Add dependencies: `express`, `zod` (runtime); `supertest`, `@types/express`, `@types/supertest` (dev). Commit with `package-lock.json`.
2. **Store, test-first.** `test/store.test.ts` (create → 0; duplicate throws, value kept; unknown → `undefined`; SQL metacharacters stored verbatim; restart on a file DB). Watch it fail, then write `src/store.ts` (`CounterStore`, `CounterExistsError`, `sqliteStore(path)` on `node:sqlite`). Commit.
3. **App factory, test-first.** Re-point `test/health.test.ts`/`test/integration.test.ts`/`test/e2e.test.ts` at `createApp(store)` where they bind the server; watch the failure; write `src/app.ts` on Express 5, moving the scaffold's middleware and `/healthz`, `/metrics`, `/greeting`. `src/server.ts` becomes the entrypoint (`TALLY_DB_PATH`, `PORT`). Commit.
4. **Counter routes, test-first.** `test/counters.test.ts` covering every row of design §2, each invalid-name class, 413 and headers. Watch it fail, then write `src/counters.ts` (Zod name schema + router). Commit.
5. Run the full local gate: `npm run lint`, `npm run type-check`, `npm run test:coverage`, `npm run build`. Fix anything red.
6. Push the branch; open the PR carrying the design note, the `Kit-Plan` trailer and the Entry Declaration on the head commit.
7. Dispatch the reviewer seat on the PR head; record each round in `docs/reviews/2026-11-17-cold-2-create-read-counter.md`; fix and re-review until APPROVE.
8. Ask the owner for the forge Approve on the graded head and the GO to merge.

## Ceremony budget

Ordinary, size M: design doc with lens table (done, `460adbd`), this plan, one reviewer seat, a review record, the owner's Approve on the PR, `Kit-Row`/`Kit-Class`/`Kit-Plan` trailers on the head commit. No security seat (ordinary).

## Verification plan

Before the push: `npm run lint` (style and obvious bugs), `npm run type-check` (types across the new seams), `npm run test:coverage` (every design §2 row and each design-promised control has a test that was seen failing first; coverage ≥80%), `npm run build` (the production build compiles). A green proves the contract against `:memory:` and file databases in one process. It does not prove multi-process concurrency or any deployed host (design §Honest ceiling). CI re-runs the same gates plus secret scan, dependency scan, SAST, SBOM and the kit's required contexts.
