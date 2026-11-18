# Design — fill the project charter's owed fields in CLAUDE.md

| Field | Value |
|---|---|
| Backlog item | `COLD-10` (Jira, space COLD) — "Fill the project charter's owed fields in CLAUDE.md" |
| Provenance | P1, authored in this slice |
| Change class | **`control-plane`** (derived: `conformance/promotion-readiness.sh --class --changed <listing>` on CLAUDE.md plus this slice's docs) |
| Size | S. The **small control-plane lane** (`skills/design/SKILL.md` §When to use): under about 50 non-test lines, adds no mechanism; this short design file is the design GO's basis |
| Owner GO | @SeaBrad72, 2026-11-17, in session: "Go cold-10", on the design presented in chat (the field values and role assignments below). Recorded with `scripts/promotion-verify.sh record --gate design` against the commit that adds this file |
| Decisions searched | `docs/governance/DECISIONS.md` §4: no ruling on this surface |

## Design note

`CLAUDE.md` is the project charter that every agent session loads. Its kit-owned entry contract (the §1 region) must stay byte-identical (`conformance/agents-brief.sh`). The project's own sections still carry Inception placeholders, though the facts now exist. This slice fills only facts, and leaves the owner's undecided fields alone.

| Section | Filled with |
|---|---|
| §2 Tech stack | TypeScript (strict) on Node.js ≥ 24; Express 5; Zod 4; SQLite via Node's built-in `node:sqlite`; Vitest + supertest; deploy target none (out of scope by charter); key libraries express, zod; ADR-000 |
| §3 Backlog backend | jira — `https://inflectionsparks.atlassian.net/browse/COLD` |
| §3 Branch protection | `github-verified` (team profile; verified live by `conformance/inception-done.sh --strict`, 2026-11-17) |
| Harness fit rationale | claude-code: native hooks (the PreToolUse guard is wired and verified) and multi-agent seats (typed reviewer and security seats reviewed every PR) |
| §4 Roles | Intent owner @SeaBrad72; Lead / integrator @SeaBrad72 (gives merge GOs; the agent actuates); Builder: the conductor agent (forge account SeaBrad72-Agent); Reviewers: the reviewer and security seats, plus @SeaBrad72's Approve on every PR; On-call / operator: n/a (no deploy); Security owner @SeaBrad72 |
| §5 Quickstart | `npm ci` · `npm run build && npm start` · `npm test` · `npm run build` |
| §7 Key references | repo, board, RUNBOOK |

**Not touched** (owner decisions not yet made; the card forbids inventing them): operator fluency, autonomy tiers, SLO, data classification, WIP limits, environments, agentic, model fit rationale, review routing, §6 conventions, the "Owed from Inception" list.

## Design-promised controls

| Control | Discharging check |
|---|---|
| The kit-owned entry contract stays byte-identical | `conformance/agents-brief.sh` (run in the dev clone, and in CI) |
| The harness fit rationale cites a fit dimension | `conformance/harness-decision-integrity.sh` |
| No bracket placeholder remains in the filled fields | reviewer reads the diff (no executable check exists for it) |

## Lens review

| # | Lens | Finding |
|---|---|---|
| 1 | Project principles | Holds: the charter records facts already decided elsewhere (ADR-000, the owner's GOs); it decides nothing new. |
| 2 | Friction | Removes friction for every future session, which reads real values instead of placeholders. Cost: one small control-plane PR. |
| 3 | Software practice | Standard: documentation follows the decisions it records. The alternative, leaving placeholders, keeps sessions guessing. |
| 4 | Agentic practice | An agent reads CLAUDE.md first, so correct roles and the quickstart reduce wrong assumptions. Every claim filled is checkable against ADR-000, the board or the repo. |
| 5 | CI | No CI time added; the existing `agents-brief` and `harness-decision-integrity` checks guard it. |
| 6 | DevOps and operations | N/A: no deploy surface; rollback is reverting the merge. |
| 7 | Security, privacy and guardrails | No capability gained. The edit is to a control-plane file, so it goes through the dev clone, a recorded design GO, a security seat and the owner's ratification. No personal data. The roles name the security owner. |
| 8 | Cost and efficiency | Ships in this project only. Size S, about 30 changed lines (estimate). |
| 9 | Product | Need: the charter is the operator's and agent's map. Metric: no placeholder remains in the filled fields. |
| 10 | Design | The smallest shape: fill the fields with facts. A larger rewrite of the charter was not considered necessary. |
| 11 | Architecture | Keeps the kit-owned entry contract byte-identical (agents-brief) and the three placement rules. |
| 12 | UX and accessibility | The reader is a person or agent opening CLAUDE.md: plain values, no placeholders. No UI. |

## Honest ceiling

The checks prove the entry contract is untouched and the fit rationale has the right shape. They do not prove the values are true; the reviewer checks each value against its source (ADR-000, the board, the repo, the owner's GOs in this session).

## Amendment log

- 2026-11-17: initial design, GO'd by the owner ("Go cold-10").
- 2026-11-17, review round 1 (reviewer APPROVE with 3 Minors; security PASS-WITH-NOTES with 2 Lows). Accuracy corrections only, no new mechanism and no new field:
  - The agent account's scope is stated as it is: write access, not admin; it actuates merges on the owner's recorded GO and cannot approve its own PRs (security L1: "push only" understated it).
  - The branch-protection line names the source of each fact: the team profile from `branch-protection-apply.sh --team`, including code-owner reviews with an empty CODEOWNERS; the checks from `REQUIRED-CHECKS.md`; and `inception-done --strict` as the point-in-time source of truth (security L2).
  - "Deploy target: none chosen", because ADR-000 leaves it open (reviewer M3).
  - **Carried, not done here:** the stale "Owed from Inception" list and the header's `Status: Inception` (reviewer M1, M2) are outside this design's GO'd scope, so they are carried on a new card.
