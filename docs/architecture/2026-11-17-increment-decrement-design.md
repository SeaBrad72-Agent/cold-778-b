# Design — increment and decrement a named counter

| Field | Value |
|---|---|
| Backlog item | `COLD-6` (Jira, space COLD) — "Increment and decrement a named counter" |
| Provenance | P1, authored in this slice; builds on `docs/architecture/2026-11-17-create-read-counter-design.md` (COLD-2) |
| Change class | `ordinary` (derived: `conformance/promotion-readiness.sh --class --changed <listing>`) |
| Size | S |
| Owner GO | @SeaBrad72, 2026-11-17, in session, on the design presented in chat. Owner decision on the same day: a decrement below zero is refused, not clamped or allowed |
| Decisions searched | `docs/governance/DECISIONS.md` §4: no ruling on this surface |

## Contract

| Request | Outcome |
|---|---|
| `POST /counters/<name>/increment`, no body or `{}` | **200** `{"name", "value"}`, value + 1 |
| `POST /counters/<name>/increment` `{"by": n}` | **200**, value + n |
| `POST /counters/<name>/decrement` (same body rules) | **200**, value − 1 or − n |
| decrement that would go below 0 | **409** `{"error": "counter cannot go below zero"}`; value unchanged |
| increment past `Number.MAX_SAFE_INTEGER` (2^53 − 1) | **409** `{"error": "counter would exceed the maximum value"}`; value unchanged |
| `by` not a whole number from 1 to 1,000,000; body not a JSON object | **400**; value unchanged |
| unknown counter | **404** `{"error": "counter not found"}` |
| invalid name | **400**, the COLD-2 name rule; the store is not called |
| body over 1 kB / bad JSON / unsupported type | 413 / 400 / 415, as COLD-2 |

## Shape

- `src/store.ts` gains `increment(name, by)` and `decrement(name, by)`. Each is **one** guarded statement: `UPDATE counters SET value = value ± ? WHERE name = ? AND <bound> RETURNING value`. The bound is `value <= MAX − by` for an increment and `value >= by` for a decrement. No read-then-write, so concurrent bumps never lose an update. When no row comes back, one read tells "not found" (`CounterNotFoundError`) from "bound hit" (`CounterBoundError`). That read classifies the error only; it never decides a write.
- `src/counters.ts` adds the two routes, with the same name check before the store, `routeName()` first, the body parser at 1 kB, and a Zod `by` schema (`z.number().int().min(1).max(1_000_000)`, default 1).

## Test plan (TDD, red first)

- **Store:** +1 / +n / −1 / −n; below-zero refused with the value kept; overflow refused with the value kept; unknown → `CounterNotFoundError`; **no lost updates:** two connections on one file database interleave 100 increments each, and the end value is 200.
- **Routes:** every contract row; `by` invalid classes (0, −1, 1.5, 1,000,001, `"5"`, `null`, `true`, array, object, NaN-like strings); a tripwire store proves an invalid name or `by` never reaches storage; span names `POST /counters/:name/increment` and `/decrement`, including on error paths; security headers.

## Design-promised controls

| Control | Discharging test |
|---|---|
| A value never goes below zero | `test/store.test.ts::decrement below zero is refused and keeps the value` |
| No lost updates under concurrent bumps | `test/store.test.ts::two processes bumping the same file concurrently lose no update` |
| An invalid name or `by` never reaches storage | `test/counters.test.ts::never calls the store for an invalid bump` |
| The value stays within the safe-integer range | `test/store.test.ts::increment past the maximum is refused and keeps the value` |

## Lens review (S, one line)

lenses: no findings except **security**: a new unauthenticated write (bump); it inherits COLD-2's controls (name allowlist, 1 kB body, loopback default) and the creation cap or rate limit carried as COLD-4 now covers bumps too. **Product**: the owner chose refusal at zero.

## Honest ceiling

The no-lost-update test runs two OS processes that bump one local file at the same time (2,000 bumps each). It proves the single guarded statement loses no update: a read-then-write variant of the same harness lost 1,887 of 4,000 updates, measured on 2026-11-17. It does not prove behaviour on a network filesystem, which is out of scope.

The error-classifying read after a refused bump runs outside the UPDATE. Across processes, a counter created or deleted by another connection in that window can change which refusal is reported (404 or 409). It never affects a write, and it cannot happen within one process.

## Amendment log

- 2026-11-17: initial design, GO'd by the owner.
- 2026-11-17, reviewer round 1 (no new mechanism):
  - The no-lost-update test was vacuous: the store is synchronous, so two connections in one process never interleave, and a read-then-write store passed it. Replaced with a two-process test, and proven load-bearing (see Honest ceiling).
  - That test showed `SQLITE_BUSY` ("database is locked") under real contention, so the store sets `PRAGMA busy_timeout = 5000`.
  - A body that is present but not JSON is refused with 415, and a JSON `null` with 400, instead of bumping by 1. Only a request with no body at all means "by 1".
