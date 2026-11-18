// Host allowlist configuration (COLD-7). Requests whose Host header is not on this list are refused with
// 421 before any route (app.ts), which closes DNS rebinding: a rebound page's browser sends the
// attacker's domain as Host. The list is the loopback names, plus TALLY_ALLOWED_HOSTS (an explicit
// comma-separated list; the owner's decision), plus a specific TALLY_HOST. Parsing fails CLOSED: a
// malformed entry stops the server at startup rather than silently allowing too much or too little.
import { isIPv6 } from 'node:net';

/** Always allowed, in the lowercase form a Host header's hostname takes. */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

const WILDCARD_BINDS = new Set(['0.0.0.0', '::', '127.0.0.1', 'localhost', '::1']);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// A DNS name or IPv4 literal: dot-separated labels of letters, digits and inner hyphens, 1-63 chars each.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);

function parseEntry(raw: string): string {
  const entry = raw.trim().toLowerCase();
  if (entry.startsWith('[') && entry.endsWith(']') && isIPv6(entry.slice(1, -1))) return entry;
  if (entry.length <= 253 && HOSTNAME.test(entry)) return entry;
  throw new ConfigError(
    `TALLY_ALLOWED_HOSTS: "${raw.trim()}" is not a host name or IP address (no scheme, port, path, ` +
      'wildcard or spaces; write an IPv6 address in brackets)',
  );
}

/** Parses TALLY_ALLOWED_HOSTS. Unset or blank is an empty list; any malformed entry throws ConfigError. */
export function parseAllowedHosts(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];
  return value.split(',').map(parseEntry);
}

/** The full allowlist for an environment: loopback, then TALLY_ALLOWED_HOSTS, then a specific TALLY_HOST. */
export function allowedHostsFrom(env: Record<string, string | undefined>): string[] {
  const hosts: string[] = [...LOOPBACK_HOSTS, ...parseAllowedHosts(env.TALLY_ALLOWED_HOSTS)];
  const bind = env.TALLY_HOST?.trim().toLowerCase();
  if (bind && !WILDCARD_BINDS.has(bind)) {
    const asHost = isIPv6(bind) ? `[${bind}]` : bind;
    if (!hosts.includes(asHost)) hosts.push(asHost);
  }
  return hosts;
}
