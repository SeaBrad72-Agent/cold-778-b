# tally

**Intent owner:** @SeaBrad72
**Created:** 2026-11-17
**Kit version adopted:** v3.248.0

## What this is

Small teams keep simple counts (stand-up attendance, bugs closed this week, coffee runs) in spreadsheets
or chat, and lose them. Tally is a tiny HTTP service for named counters, built for a small team that wants
a shared counter it can bump from a script or a browser.

## Get started

Needs Node.js 24 or later (it uses the built-in `node:sqlite`).

```
npm ci && npm run build && npm start
```

Then, from another terminal:

```
curl -s -X POST localhost:3000/counters -H 'Content-Type: application/json' -d '{"name":"coffee-runs"}'
curl -s localhost:3000/counters/coffee-runs
curl -s -X POST localhost:3000/counters/coffee-runs/increment
curl -s -X POST localhost:3000/counters/coffee-runs/increment -H 'Content-Type: application/json' -d '{"by":3}'
curl -s -X POST localhost:3000/counters/coffee-runs/decrement
```

A counter never goes below zero: a decrement that would take it there answers `409` and leaves the value unchanged.

Writes from a web page on another site are refused (`403 cross-site request refused`), so a page you visit cannot change your counters through your browser. curl and scripts are unaffected.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | The port to listen on. |
| `TALLY_HOST` | `127.0.0.1` | The interface to listen on. The counter API has no login, so the default is this machine only; set `0.0.0.0` (for example in a container) to open it to the network on purpose. |
| `TALLY_DB_PATH` | `./data/tally.db` | The SQLite file that holds the counters. Its folder is created if missing; `/data/` is gitignored. An empty value falls back to the default. |

`RUNBOOK.md` carries the full setup, deploy, troubleshoot and rollback detail.

## How this project is run

This project follows a defined engineering process, and the documents are part of the repo:

- **`CLAUDE.md`** — the project guide: charter, per-project config, roles. Read it first.
- **`ENGINEERING-PRINCIPLES.md`** — the principles and the Definition of Done. Authoritative.
- **`DEVELOPMENT-PROCESS.md`** — how work flows: Discover → Plan → Build → Review → Release.
- **`DEVELOPMENT-STANDARDS.md`** + `profiles/<stack>.md` — the quality bar and its concrete form.
- **`START-HERE.md`** — the guided path if you are new to the process itself.
- **`RUNBOOK.md`** — operating the system: setup, deploy, troubleshoot, rollback.
- **`SECURITY.md`** — how to report a vulnerability.

Contributions go through a branch, a PR, and the gates declared in `REQUIRED-CHECKS.md`.

---

Built with [Sparkwright](https://github.com/SeaBrad72/sparkwright) v3.248.0.
