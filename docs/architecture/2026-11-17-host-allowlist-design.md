# Design — allowlist the Host header against DNS rebinding

| Field | Value |
|---|---|
| Backlog item | `COLD-7` (Jira, space COLD) — "Allowlist the Host header against DNS rebinding" |
| Provenance | P4/P1: the card carries the need (from COLD-6 security L4, made worse by COLD-8 security M1); the design is authored here |
| Change class | `ordinary` (derived: `conformance/promotion-readiness.sh --class --changed <listing>`) |
| Size | S |
| Owner GO | @SeaBrad72, 2026-11-17, in session. Owner decision, same day: when tally is opened to the network, the allowed hosts come from an explicit `TALLY_ALLOWED_HOSTS` list (the alternatives, "any host when open" and "loopback only, always", were offered and not chosen) |
| Decisions searched | `docs/governance/DECISIONS.md` §4: no ruling on this surface |

## Problem

DNS rebinding lets a web page make its own domain resolve to 127.0.0.1, so the browser sends requests to tally with `Host: evil.example`. The cross-site write guard (COLD-6) stops writes from standards-following browsers, because they always send `Origin`. But reads are exempt, and since COLD-8 a rebound page can read the whole table by following `next`. An old browser that omits `Origin` could also write.

## Contract

| Request | Outcome |
|---|---|
| any method, `Host` a loopback name (`localhost`, `127.0.0.1`, `[::1]`) with any or no port | proceeds to the routes (unchanged behaviour) |
| any method, `Host` a name in `TALLY_ALLOWED_HOSTS` (case-insensitive, any or no port) | proceeds |
| any method, `Host` equal to a specific `TALLY_HOST` (not `0.0.0.0` / `::`) | proceeds |
| any other `Host`, or none | **421** `{"error": "host not allowed"}`, before any route; security headers, request id, log line and span (`<METHOD> host-refused`) as usual |
| `TALLY_ALLOWED_HOSTS` with a malformed entry (a scheme, a path, a port, whitespace inside, an empty item, a character outside hostname/IP syntax) | the server **refuses to start**, naming the entry |

The cross-site write guard is unchanged: a write's `Origin` must still be a loopback name equal to `Host`. With no web UI in scope, a browser page on an allowed network host cannot write. A future UI slice revisits that.

## Shape

- `src/config.ts`: `parseAllowedHosts(value)` returns lowercased host names or throws a `ConfigError` naming the bad entry. `allowedHostsFrom(env)` combines the loopback names, the list and a specific `TALLY_HOST`.
- `src/app.ts`: `createApp(store, { allowedHosts })` mounts `refuseUnknownHosts` right after telemetry, before the cross-site guard and every route. The default `allowedHosts` is loopback only, so existing tests and callers are unchanged. The `Host` header is split into hostname and port the same way for IPv6 brackets.
- `src/server.ts` builds the list from the environment at boot; a `ConfigError` exits non-zero with its message.

## Test plan (TDD, red first)

- **Config:** valid lists (one name, several, IPs, IPv6 in brackets, mixed case lowered, surrounding spaces trimmed); each malformed class refused with the entry named; `TALLY_HOST` specific versus wildcard.
- **App:** a foreign Host refused with 421 on GET (single counter, list, `/healthz`), POST, DELETE and a bump, with nothing changed; rebinding with no Origin; a missing Host (HTTP/1.0); loopback names with and without ports; an allowed list name with mixed case and a port; the span name and headers on a 421.

## Design-promised controls

| Control | Discharging test |
|---|---|
| A request with a Host that is not allowed never reaches a route | `test/app.test.ts::refuses a request whose Host is not allowed with 421 and changes nothing` |
| A malformed allowlist stops the server instead of allowing the wrong hosts | `test/config.test.ts::refuses a malformed allowed-hosts entry` |

## Lens review (S, one line)

lenses: no findings except **security**: closes DNS rebinding for reads and Origin-less writes; fail-closed configuration. **Operations**: opening the port now needs `TALLY_ALLOWED_HOSTS` too, so a misconfiguration surfaces as a 421 or a refusal at startup, never as silent exposure. **Product**: the owner chose the explicit list.

## Honest ceiling

The allowlist checks the `Host` header the client sent; it is not authentication. Any client that can reach the port and sends an allowed `Host` (curl, a script) is served, as before; auth stays out of scope by charter. It defeats DNS rebinding because a browser always sends the rebound domain as `Host`.

## Amendment log

- 2026-11-17: initial design, GO'd by the owner.
- 2026-11-17, review round 1 (reviewer APPROVE with 3 Minors; security PASS-WITH-NOTES with 5 Lows; hardening, no new mechanism):
  - A request with **two Host fields** is refused (RFC 9112 §3.2; Node kept the first, so `localhost` then `evil` was served). An **absolute-form** request target (`GET http://other/…`), whose authority overrides Host, is refused. `*` is allowed for OPTIONS only.
  - **`TALLY_HOST` is validated** with the same grammar as the list (a malformed value stops startup). Every spelling of all-interfaces (`0`, `::0`, `0:0:0:0:0:0:0:0`, as well as `0.0.0.0` and `::`) is recognised after numeric normalisation, and the bind value is trimmed the same way for `listen`.
  - **IPv6 entries are stored in canonical form** (`[fe80:0:0::1]` becomes `[fe80::1]`, what a browser sends), and a zone id (`%eth0`) is refused, because a Host header cannot carry one and the entry could never match.
  - The cross-site guard's loopback set is built from the one `LOOPBACK_HOSTS` list, so the two controls cannot drift.
  - `.env.example` and a RUNBOOK line are carried on **COLD-3** (security Low-5).
