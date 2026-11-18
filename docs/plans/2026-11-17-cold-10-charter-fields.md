# Plan record — `COLD-10`

| Field | Value |
|-------|-------|
| Row | `COLD-10` — Fill the project charter's owed fields in CLAUDE.md |
| Design of record | `docs/architecture/2026-11-17-charter-fields-design.md` (design GO recorded: `promotion-verify.sh record --gate design`, approved-sha `6367c8e`, `[committer]`, go-by @SeaBrad72, token "Go cold-10", scope `branch/feature/cold-10-charter-fields`) |
| Change class (derived, never self-asserted) | `control-plane` |
| Build model | **dev clone**: `git clone https://github.com/SeaBrad72/cold-778-b.git /private/tmp/tally-cold10`; the guard stays armed on the real repo |

## Team

`.kit/model-map.conf` binds no tier (all `unset`), so every seat runs on the session's model.

| seat | tier | concrete model | why |
|---|---|---|---|
| conductor | unset | claude-opus-5-5 (the session) | holds the owner's context and GO |
| builder | unset | claude-opus-5-5 — **conductor** builds, in the dev clone | one documentation file; no fan-out |
| reviewer | unset | claude-opus-5-5, the `reviewer` seat, a fresh context | builder ≠ reviewer; checks each value against its source |
| security | unset | claude-opus-5-5, the `security` seat, a fresh context | owed on every control-plane change |

## Task list

1. Design file committed (`6367c8e`); design GO recorded against it.
2. Edit `CLAUDE.md` in the dev clone: §2, §3 (backlog link, branch protection), the harness fit rationale, §4, §5, §7. Do not touch the kit-owned §1 region.
3. Run in the clone: `sh conformance/agents-brief.sh`, `sh conformance/harness-decision-integrity.sh`. Commit; push; open the PR.
4. Dispatch the reviewer and security seats in parallel (`git archive` exports; no checkout).
5. Review record as the final head with all four trailers; owner's Approve (also the `control-plane-ratification` signal) and merge GO; `promotion-verify.sh land`.

## Ceremony budget

Control-plane, small lane: dev-clone authoring; this short design file as the design GO's basis, the GO recorded (`ceremony-binding`); this plan; reviewer and security seats; a review record; the owner's non-author Approve as ratification; the merge by `land` with `--go-by`; the four `Kit-*` trailers on the head commit.

## Verification plan

In the dev clone: `agents-brief` (the entry contract is byte-identical) and `harness-decision-integrity` (the fit rationale cites a fit dimension). In CI: every required check, including `ceremony-binding` (the design GO record) and `control-plane-ratification` (the owner's Approve). A green proves shape, not truth; the reviewer checks each value against its source (design §Honest ceiling).
