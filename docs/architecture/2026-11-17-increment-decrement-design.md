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
| A cross-site browser write never changes a counter (amendment, security M1) | `test/app.test.ts::refuses a cross-site write with 403 and changes nothing` |

## Lens review (S, one line)

lenses: no findings except **security**: a new unauthenticated write (bump); it inherits COLD-2's controls (name allowlist, 1 kB body, loopback default) and the creation cap or rate limit carried as COLD-4 now covers bumps too. **Product**: the owner chose refusal at zero.

## Honest ceiling

The no-lost-update test runs two OS processes on one local file, 2,000 bumps each. A rendezvous releases them together: each child writes a ready file after opening its connection, and the parent writes the go file only when both are ready. It proves the single guarded statement loses no update. Measured on 2026-11-17 with the same harness: a read-then-write variant failed the test in **20 of 20 runs** (it ended at 2,000 every time), and the real store passed 5 of 5. The detector is still timing-based, not a formal proof. An earlier barrier, written before the children loaded, was a no-op: the reviewer measured 1 miss in 10. It does not prove behaviour on a network filesystem, which is out of scope.

The error-classifying read after a refused bump runs outside the UPDATE. Across processes, a counter created or deleted by another connection in that window can change which refusal is reported (404 or 409). It never affects a write, and it cannot happen within one process.

## Amendment log

- 2026-11-17: initial design, GO'd by the owner.
- 2026-11-17, reviewer round 1 (no new mechanism):
  - The no-lost-update test was vacuous: the store is synchronous, so two connections in one process never interleave, and a read-then-write store passed it. Replaced with a two-process test, and proven load-bearing (see Honest ceiling).
  - That test showed `SQLITE_BUSY` ("database is locked") under real contention, so the store sets `PRAGMA busy_timeout = 5000`.
  - A body that is present but not JSON is refused with 415, and a JSON `null` with 400, instead of bumping by 1. Only a request with no body at all means "by 1".
- 2026-11-17, security seat round 1, M1, **owner decision: refuse cross-site browser writes** (options were: refuse cross-site / always require JSON / carry as a card). A new **mechanism**, so recorded here as a design revision, with the owner's GO given in the session:
  - Every write (any method but GET, HEAD and OPTIONS) is refused with **403** `cross-site request refused` when `Sec-Fetch-Site` is `cross-site` or `same-site`, or when an `Origin` is present and is not a loopback name (`localhost`, `127.0.0.1`, `[::1]`) equal to `Host`. The loopback requirement defeats DNS rebinding, where Origin and Host both name the attacker's domain.
  - It covers `POST /counters` (COLD-2) as well as the bumps. curl and scripts send neither header and are unaffected; reads are unaffected.
  - Consequence: a browser page on another host cannot write to tally even when `TALLY_HOST=0.0.0.0`. There is no web UI in scope, so nothing breaks; a future UI slice must revisit this list.
  - Design-promised control: **a cross-site browser write never changes a counter**, discharged by `test/app.test.ts::refuses a cross-site write with 403 and changes nothing`, proven load-bearing (weakening the check to Origin-equals-Host let the rebinding case through, and the test failed).
  - Not built: a CHECK constraint on the column (the security note, defence in depth only). The classifying-read window (security L2) is in the Honest ceiling and must be revisited by the delete slice.
- 2026-11-17, reviewer round 2 and security round 2 (no new mechanism):
  - The two-process test's barrier is now a real rendezvous (reviewer I1-R2); see Honest ceiling.
  - `Sec-Fetch-Site` is refused unless it is absent, `same-origin` or `none` (security L3: mixed case, joined or unknown values were let through).
  - A refused cross-site write is traced as `<METHOD> cross-site-refused` (reviewer m1).
  - Accepted as is: the Origin/Host comparison is case-sensitive and port-literal (reviewer m2; every mismatch fails closed), and an empty chunked request is treated as a body (reviewer m3; fails closed with 415).
  - Carried: an allowlist for the `Host` header, against DNS rebinding for reads and for Origin-less writes from old browsers, is **COLD-7** (security L4).
- 2026-11-17, **closed by COLD-9** (`docs/architecture/2026-11-17-delete-counter-design.md`): the classifying-read window noted in this design's Honest ceiling (reviewer M1, security L2) is closed. A bump's guarded UPDATE and its classifying read now run in one `BEGIN IMMEDIATE` transaction, pinned by deterministic tests that fail without it. The same change fixed a lost write on this design's code: an auto-commit that hit `SQLITE_BUSY` was swallowed, and a bump answered success that was never stored.
