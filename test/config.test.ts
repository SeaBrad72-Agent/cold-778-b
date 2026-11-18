import { describe, expect, it } from 'vitest';
import { ConfigError, LOOPBACK_HOSTS, allowedHostsFrom, parseAllowedHosts } from '../src/config.js';

describe('parseAllowedHosts', () => {
  it('returns an empty list for an unset or blank value', () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts('')).toEqual([]);
    expect(parseAllowedHosts('   ')).toEqual([]);
  });

  it('stores IPv6 entries in canonical form, so they match what a browser sends', () => {
    expect(parseAllowedHosts('[FE80:0:0::1],[::ffff:7f00:1]')).toEqual(['[fe80::1]', '[::ffff:7f00:1]']);
  });

  it('parses names, IPv4 and bracketed IPv6, lowercased and trimmed', () => {
    expect(parseAllowedHosts(' Tally.LAN , 192.168.1.20,[fe80::1],box ')).toEqual([
      'tally.lan',
      '192.168.1.20',
      '[fe80::1]',
      'box',
    ]);
  });

  it.each([
    ['a scheme', 'http://tally.lan'],
    ['a path', 'tally.lan/x'],
    ['a port', 'tally.lan:3000'],
    ['whitespace inside', 'tally lan'],
    ['an empty item', 'tally.lan,,box'],
    ['a trailing comma', 'tally.lan,'],
    ['a wildcard', '*.lan'],
    ['userinfo', 'me@tally.lan'],
    ['an unbracketed IPv6', 'fe80::1'],
    ['a leading hyphen', '-tally.lan'],
    ['a too-long label', `${'a'.repeat(64)}.lan`],
    ['an IPv6 zone id (can never match a Host header)', '[fe80::1%eth0]'],
  ])('refuses a malformed allowed-hosts entry: %s', (_label, value) => {
    expect(() => parseAllowedHosts(value)).toThrow(ConfigError);
    expect(() => parseAllowedHosts(value)).toThrow(/TALLY_ALLOWED_HOSTS/);
  });
});

describe('allowedHostsFrom', () => {
  it('always allows the loopback names', () => {
    expect(allowedHostsFrom({})).toEqual([...LOOPBACK_HOSTS]);
    expect(LOOPBACK_HOSTS).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  it('adds the TALLY_ALLOWED_HOSTS entries', () => {
    expect(allowedHostsFrom({ TALLY_ALLOWED_HOSTS: 'tally.lan' })).toEqual([...LOOPBACK_HOSTS, 'tally.lan']);
  });

  it('adds a specific TALLY_HOST, but not a wildcard', () => {
    expect(allowedHostsFrom({ TALLY_HOST: '192.168.1.20' })).toEqual([...LOOPBACK_HOSTS, '192.168.1.20']);
    expect(allowedHostsFrom({ TALLY_HOST: '0.0.0.0' })).toEqual([...LOOPBACK_HOSTS]);
    expect(allowedHostsFrom({ TALLY_HOST: '::' })).toEqual([...LOOPBACK_HOSTS]);
    expect(allowedHostsFrom({ TALLY_HOST: '127.0.0.1' })).toEqual([...LOOPBACK_HOSTS]);
  });

  it('brackets and canonicalises a specific IPv6 TALLY_HOST to match the Host header form', () => {
    expect(allowedHostsFrom({ TALLY_HOST: 'fe80::1' })).toEqual([...LOOPBACK_HOSTS, '[fe80::1]']);
    expect(allowedHostsFrom({ TALLY_HOST: 'FE80:0:0::1' })).toEqual([...LOOPBACK_HOSTS, '[fe80::1]']);
  });

  it.each(['::0', '0:0:0:0:0:0:0:0', '0', '0.0.0.0', '::'])(
    'recognises every spelling of an all-interfaces TALLY_HOST: %s',
    (bind) => {
      expect(allowedHostsFrom({ TALLY_HOST: bind })).toEqual([...LOOPBACK_HOSTS]);
    },
  );

  it.each([
    ['junk', 'a b'],
    ['a wildcard', '*'],
    ['a zone id', 'fe80::1%eth0'],
    ['a scheme', 'http://box'],
    // Security PR #5 round 2, Low-A: these pass the name grammar but are not valid addresses; they must
    // stop startup with the named ConfigError, not a raw TypeError from the URL parser.
    ['an out-of-range IPv4 octet', '256.1.1.1'],
    ['five IPv4 parts', '1.2.3.4.5'],
  ])('refuses a malformed TALLY_HOST: %s', (_label, bind) => {
    expect(() => allowedHostsFrom({ TALLY_HOST: bind })).toThrow(ConfigError);
    expect(() => allowedHostsFrom({ TALLY_HOST: bind })).toThrow(/TALLY_HOST/);
  });

  it('propagates a malformed list as a ConfigError', () => {
    expect(() => allowedHostsFrom({ TALLY_ALLOWED_HOSTS: 'http://x' })).toThrow(ConfigError);
  });
});
