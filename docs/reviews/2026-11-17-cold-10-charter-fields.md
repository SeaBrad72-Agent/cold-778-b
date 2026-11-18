# Review Record — `COLD-10`

| Field | Value |
|-------|-------|
| Change / PR | #6 — COLD-10, fill the project charter's owed fields (control-plane) |
| Risk tier | `high-risk` — trigger: control-plane (CLAUDE.md, the charter every agent session loads) |
| Builder | conductor (the main session, claude-opus-5-5), authoring in the dev clone `/private/tmp/tally-cold10` |
| Independent review by | the kit's `reviewer` seat and a separate `security` seat (owed on control-plane), each a fresh context — findings recorded below |

---

Builder: conductor (main session, claude-opus-5-5; dev clone /private/tmp/tally-cold10)
Reviewer: reviewer seat (agents/reviewer.agent.md, fresh context, claude-opus-5-5)

## Rounds

| commit | reviewer seat (role first) | verdict (APPROVE\|NEEDS-FIXES) | findings (n) |
|---|---|---|---|
| 9320b01 | reviewer, round 1 | APPROVE | 3 |
| 95f0017 | reviewer, round 2 | APPROVE | 2 |

## Findings

| id | file:line | severity | disposition |
|---|---|---|---|
| R1-M1 — the "Owed from Inception" list still shows finished items as owed | CLAUDE.md:160 | Minor | accepted — outside the GO'd design's scope; carried as COLD-11 |
| R1-M2 — the header still reads `Status: Inception`, and an agent could read itself as exempt from the five acts | CLAUDE.md:33 | Minor | accepted — outside the GO'd design's scope; carried as COLD-11 (the owner picks the status) |
| R1-M3 — "Deploy target: none" read as a decision; ADR-000 leaves it open | CLAUDE.md:71 | Minor | fixed 95f0017 |
| R2-m1 — the design's amendment log said "carried on a new card" without its ID | docs/architecture/2026-11-17-charter-fields-design.md:64 | Minor | fixed — this record names COLD-11 for R1-M1 and R1-M2 |
| R2-m2 — cosmetic: the template's trailing clause follows the new branch-protection text after a dash | CLAUDE.md:89 | Minor | accepted — wording only; meaning unchanged |
| S1-L1 — "push only" understated the agent account, which also merges | CLAUDE.md:120 | Low | fixed 95f0017 — now "write access, not admin; actuates merges only on the owner's recorded GO; cannot approve its own PRs". Not-admin verified live earlier: GitHub reported this account's permissions on the repo as `admin:false, maintain:false, push:true` (field report item 14) |
| S1-L2 — the branch-protection line omitted code-owner reviews and stated a live count as fact | CLAUDE.md:89 | Low | fixed 95f0017 — it names its sources and calls `inception-done --strict` the point-in-time truth |
| S1-I1 — commits are authored as `cold-778-b` (the git identity) while the forge account is `SeaBrad72-Agent` | (commit metadata) | Info | accepted — both are the agent; recorded here so the trail lines up (the git identity comes from the session's GIT_CONFIG_GLOBAL; pushes use the SeaBrad72-Agent forge credential) |

## Design-promised controls

| control (from the design) | discharged by |
|---|---|
| The kit-owned entry contract stays byte-identical | `conformance/agents-brief.sh::entry contract` |
| The harness fit rationale cites a fit dimension | `conformance/harness-decision-integrity.sh::Harness fit rationale cites a fit dimension` |
| No bracket placeholder remains in the filled fields | not built, because no executable check exists for it; the reviewer read each filled field in both rounds |

## Security review

ran — seat security, verdict: PASS

| round | commit | seat | verdict | findings (n) |
|---|---|---|---|---|
| 1 | 9320b01 | security | PASS-WITH-NOTES | 2 Low + 3 Info |
| 2 | 95f0017 | security | PASS | 0 |

The seat reviewed CLAUDE.md as an instruction-injection and governance surface (it is loaded into every agent session): no added line instructs an agent, widens a capability, weakens a gate or names a different approver. Separation of duties is unchanged. It verified the design-GO record on origin's `refs/notes/promotions` (approved-sha `6367c8e`, gate design, class control-plane, kit-row COLD-10, scope `branch/feature/cold-10-charter-fields`, token "Go cold-10", go-by SeaBrad72).

## Task status

| task (from the plan) | state (`done` \| `pending`) | commit |
|---|---|---|
| 1. Design file; design GO recorded | done | 6367c8e |
| 2. Edit CLAUDE.md in the dev clone | done | 9320b01 |
| 3. agents-brief + harness-decision-integrity; commit; PR | done | #6 |
| 4. Reviewer and security seats | done | 95f0017 |
| 5. Review record; owner's Approve (ratification) and merge GO; `land` | pending | — |

---

## Agent-review findings

- **Reviewer seat:** APPROVE in both rounds. It checked every filled value against its source (ADR-000, package.json, vitest config, REQUIRED-CHECKS.md, branch-protection-apply.sh, CODEOWNERS, .claude/settings.json, agents/), and confirmed the merge of origin/main brings nothing beyond main.
- **Security seat:** PASS-WITH-NOTES, then PASS. Two accuracy corrections on security-relevant statements; the design-GO record was verified on origin.

## Human ratification
- **Ratified by:** owed — @SeaBrad72, by a non-author Approve on PR #6's head (the `control-plane-ratification` signal)
- **Date:** owed
- **Disposition:** findings addressed; four accepted with reason (R1-M1 and R1-M2 → COLD-11, R2-m2, S1-I1)

## High-risk acknowledgments

For each material finding:

- Finding S1-L1 (the agent account's scope) → *resolved by 95f0017; not-admin verified against GitHub's permission read in session.*
- Finding S1-L2 (the branch-protection statement) → *resolved by 95f0017; the statement now defers to `inception-done --strict`.*
- Control-plane obligation: dev-clone authoring, the recorded design GO (`ceremony-binding`), a security seat, owner ratification, merge by `land` → *acknowledged: all done or owed in this record, in that order.*
