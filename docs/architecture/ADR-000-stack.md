# ADR-000: Technology Stack Selection

> The stack-decision record produced at Inception (`START-HERE.md` step 2). It makes `profiles/typescript-node.md` authoritative for this project, with the storage deviation recorded below.

**Status:** Accepted
**Date:** 2026-11-17
**Deciders:** @SeaBrad72 (intent owner)

## Context
We're starting tally: a tiny HTTP service for named counters, for a small team that wants to bump a shared counter from a script or a browser (charter: `CLAUDE.md` §1). The workload is a handful of short requests (create, increment, decrement, get, list, delete) plus a health check. The data is a small table of name → integer. There are no accounts, no UI, no tenants, and no production deployment in scope. The success bar is tested behaviour at ≥80% coverage and green CI on every merge.

## Decision
Use **TypeScript (strict) on Node.js ≥24, Express for the HTTP layer, and SQLite for storage**, captured in `profiles/typescript-node.md`. Testing is Vitest + supertest; validation is Zod.

## Fit rationale
- **Workload:** IO-bound, low-throughput request/response with no CPU-bound work. Node's event loop handles it with no tuning, and the latency needs are trivial.
- **Data:** a single small relation (counter name → value) with atomic increments. SQLite gives durable storage and transactional `UPDATE … SET value = value + 1` from one file, with no database server. That matches the charter's "simple storage" and keeps counters from being lost, which is the problem being solved.
- **Ecosystem / libraries:** Express, Zod and supertest cover routing, input validation and HTTP-level tests directly, and the profile already wires Vitest coverage, ESLint and `tsc` into CI.
- **Pipeline / iteration:** SQLite runs in-process, so tests and CI need no database service container. That keeps the CI pipeline simple and fast, which matters for the "green on every merge" success metric.
- **Deploy:** production deployment is out of scope. A single process with a file-backed store runs anywhere Node runs, which leaves the later deploy-target decision open.

## Alternatives considered
1. **PostgreSQL + Prisma (the profile's default archetype)** — pros: scales to many writers and tenants, and matches the profile and its `compose.yaml` · cons: a database server in dev, test and CI for a single tiny table; more moving parts than the charter needs.
2. **In-memory store** — pros: the simplest possible implementation · cons: counters are lost on every restart, which defeats the charter's problem statement.

## Consequences
- Profile in effect: `profiles/typescript-node.md`, with **SQLite in place of the profile's Postgres + Prisma default**.
- Easier: local runs, tests and CI need no database service. Harder: concurrent writes are serialized by SQLite's single writer, which is acceptable for a small team's request rate. Moving to many tenants or high write volume would mean revisiting storage (both are out of scope).
- Accepted trade-off: the inception kept the kit's **db-backed archetype** (the `.db-backed` marker, the `kit:db-backed` CI region and the DB/Redis lines in `.env.example`), which assumes Postgres. Whether to keep or strip it is a follow-up; see below.

## Follow-up
- [x] Profile selected (`typescript-node`) and committed with the incepted baseline
- [ ] CI baseline green on the empty project (per profile)
- [ ] `.env.example` seeded from profile
- [ ] Decide whether to strip the Postgres-oriented db-backed archetype (`incept --no-db` scope) now that storage is SQLite
- [ ] Choose the SQLite driver (`better-sqlite3` or Node's built-in `node:sqlite`) in the first storage slice
