// Host allowlist configuration (COLD-7). Requests whose Host header is not on this list are refused with
// 421 before any route (app.ts), which closes DNS rebinding: a rebound page's browser sends the
// attacker's domain as Host. The list is the loopback names, plus TALLY_ALLOWED_HOSTS (an explicit
// comma-separated list; the owner's decision), plus a specific TALLY_HOST. Parsing fails CLOSED: a
// malformed entry stops the server at startup rather than silently allowing too much or too little.
import { isIPv6 } from 'node:net';

/** Always allowed, in the lowercase form a Host header's hostname takes. */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// A DNS name or IPv4 literal: dot-separated labels of letters, digits and inner hyphens, 1-63 chars each.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);

/** The canonical bracketed form a browser sends in Host, e.g. `[fe80::1]` for `FE80:0:0::1`. A zone id
 * (`%eth0`) is refused: a Host header cannot carry one, so such an entry could never match. */
function canonicalIPv6(address: string): string | undefined {
  if (address.includes('%') || !isIPv6(address)) return undefined;
  return new URL(`http://[${address}]`).hostname;
}

function parseEntry(raw: string): string {
  const entry = raw.trim().toLowerCase();
  if (entry.startsWith('[') && entry.endsWith(']')) {
    const canonical = canonicalIPv6(entry.slice(1, -1));
    if (canonical) return canonical;
  } else if (entry.length <= 253 && HOSTNAME.test(entry)) {
    return entry;
  }
  throw new ConfigError(
    `TALLY_ALLOWED_HOSTS: "${raw.trim()}" is not a host name or IP address (no scheme, port, path, ` +
      'wildcard, zone id or spaces; write an IPv6 address in brackets)',
  );
}

/** TALLY_HOST as the Host-header form it would be reached by, or undefined for a bind that adds nothing
 * (any spelling of all-interfaces, or loopback, which is always allowed). Malformed: ConfigError. */
function bindAsHost(raw: string): string | undefined {
  const bind = raw.trim().toLowerCase();
  if (bind === '') return undefined;
  let host: string | undefined;
  if (isIPv6(bind) || bind.includes(':')) host = canonicalIPv6(bind);
  else if (bind.length <= 253 && HOSTNAME.test(bind)) host = bind;
  if (!host) {
    throw new ConfigError(`TALLY_HOST: "${raw.trim()}" is not a host name or IP address`);
  }
  // Normalise numeric forms (`0`, `::0`, `0:0:0:0:0:0:0:0`) to spot every spelling of all-interfaces.
  const normalised = new URL(`http://${host}`).hostname;
  if (normalised === '0.0.0.0' || normalised === '[::]') return undefined;
  return host;
}

/** Parses TALLY_ALLOWED_HOSTS. Unset or blank is an empty list; any malformed entry throws ConfigError. */
export function parseAllowedHosts(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];
  return value.split(',').map(parseEntry);
}

/** The full allowlist for an environment: loopback, then TALLY_ALLOWED_HOSTS, then a specific TALLY_HOST. */
export function allowedHostsFrom(env: Record<string, string | undefined>): string[] {
  const hosts: string[] = [...LOOPBACK_HOSTS];
  const add = (h: string | undefined) => {
    if (h !== undefined && !hosts.includes(h)) hosts.push(h);
  };
  for (const h of parseAllowedHosts(env.TALLY_ALLOWED_HOSTS)) add(h);
  add(env.TALLY_HOST === undefined ? undefined : bindAsHost(env.TALLY_HOST));
  return hosts;
}
