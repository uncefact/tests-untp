const mockDnsLookup = jest.fn();
jest.mock('node:dns', () => ({
  promises: {
    lookup: (...args: unknown[]) => mockDnsLookup(...args),
  },
}));

// Defaults to the real `ipaddr.js` behaviour so every test other than the
// fail-closed ones below exercises the genuine range/parse logic; only the
// tests that need to force a parser failure or a defensive branch override
// the implementation for a single call via `mockImplementationOnce`.
const actualIpaddrParse: (typeof import('ipaddr.js'))['parse'] = jest.requireActual('ipaddr.js').parse;
const mockIpaddrParse = jest.fn((...args: Parameters<typeof actualIpaddrParse>) => actualIpaddrParse(...args));
jest.mock('ipaddr.js', () => {
  const actual = jest.requireActual('ipaddr.js');
  return {
    ...actual,
    parse: (...args: Parameters<typeof actualIpaddrParse>) => mockIpaddrParse(...args),
  };
});

import { isPrivateIpv4, isPrivateIpv6, validatePublicUrl } from './validate-public-url';

describe('isPrivateIpv4', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.255.255.255', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.0.1', true],
    ['192.168.255.255', true],
    ['169.254.169.254', true],
    ['169.254.0.1', true],
    ['0.0.0.0', true],
    ['0.255.255.255', true],
    // Documentation (RFC 5737 / TEST-NET-1)
    ['192.0.2.1', true],
    // Benchmarking (RFC 2544)
    ['198.18.0.1', true],
    ['198.19.255.255', true],
    // Multicast (RFC 3171)
    ['224.0.0.1', true],
    ['239.255.255.255', true],
    // Reserved (RFC 1700 and friends)
    ['240.0.0.1', true],
    ['255.255.255.254', true],
    // Carrier-grade NAT (RFC 6598)
    ['100.64.0.1', true],
    ['93.184.216.34', false],
    ['8.8.8.8', false],
    ['172.32.0.1', false],
    ['1.1.1.1', false],
  ])('isPrivateIpv4(%s) returns %s', (address, expected) => {
    expect(isPrivateIpv4(address)).toBe(expected);
  });

  it('returns false for invalid addresses', () => {
    expect(isPrivateIpv4('not-an-ip')).toBe(false);
    expect(isPrivateIpv4('256.0.0.1')).toBe(false);
    expect(isPrivateIpv4('1.2.3')).toBe(false);
  });

  it('fails closed when ipaddr.js cannot parse a value node:net accepted', () => {
    mockIpaddrParse.mockImplementationOnce(() => {
      throw new Error('parser/version skew');
    });
    expect(isPrivateIpv4('93.184.216.34')).toBe(true);
  });
});

describe('isPrivateIpv6', () => {
  it.each([
    ['::', true],
    ['::1', true],
    ['fe80::1', true],
    ['fe80:0000::1', true],
    // Unique-local (RFC 4193)
    ['fd00::1', true],
    ['fc00::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:192.168.1.1', true],
    ['::ffff:93.184.216.34', false],
    // IPv4-mapped form in hex-group notation (equivalent to ::ffff:127.0.0.1
    // above); `URL.hostname` normalises bracketed literals to this shape, so
    // the dotted-quad form above alone would never actually be exercised by
    // validatePublicUrl.
    ['::ffff:7f00:1', true],
    // Deprecated IPv4-compatible form (RFC 4291 section 2.5.5.1): the same
    // embedded-address structure as IPv4-mapped but without the 0xffff
    // marker. `::7f00:1` is `::127.0.0.1` and `::a9fe:a9fe` is
    // `::169.254.169.254` (cloud metadata) in hex-group notation, the exact
    // shape `URL.hostname` produces for a bracketed literal.
    ['::7f00:1', true],
    ['::a9fe:a9fe', true],
    // Same embedded-form structure but wrapping a genuine public address
    // (`::5db8:d822` is `::93.184.216.34`): the IPv4-compatible form is
    // rejected unconditionally regardless of the embedded address, because
    // the form itself (RFC 4291 section 2.5.5.1) is deprecated, IANA-reserved
    // space that does not route, not merely a wrapper around a real address.
    ['::5db8:d822', true],
    // Documentation (RFC 3849 / RFC 2928): reserved, not routable, and must
    // not be treated as public even though it looks like an ordinary
    // globally-scoped (2000::/3) address.
    ['2001:db8::1', true],
    // Unallocated / IANA-reserved space above the Global Unicast block.
    // `ipaddr.js` has no named special range for any of these, so its
    // `range()` reports the 'unicast' fallback default for all of them; the
    // Global Unicast (2000::/3) gate is what correctly denies them.
    ['4000::1', true],
    ['fe00::1', true],
    ['101::1', true],
    ['100:0:0:1::1', true],
    // Decommissioned 6bone experimental block (3ffe::/16): sits inside
    // 2000::/3 (so the Global Unicast gate alone would let it through) and
    // `ipaddr.js` 2.4.0 has no named range for it (reports the 'unicast'
    // fallback), so it needs the explicit reject.
    ['3ffe::1', true],
    // Public IPv6 literal (bracket-stripped by the caller before reaching here)
    ['2606:4700:4700::1111', false],
    ['2001:4860:4860::8888', false],
  ])('isPrivateIpv6(%s) returns %s', (address, expected) => {
    expect(isPrivateIpv6(address)).toBe(expected);
  });

  it('returns false for invalid addresses', () => {
    expect(isPrivateIpv6('not-an-ip')).toBe(false);
    expect(isPrivateIpv6('93.184.216.34')).toBe(false);
  });

  it('fails closed when ipaddr.js cannot parse a value node:net accepted', () => {
    mockIpaddrParse.mockImplementationOnce(() => {
      throw new Error('parser/version skew');
    });
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(true);
  });

  it('fails closed when ipaddr.js reports a non-ipv6 kind for an IPv6-shaped input', () => {
    // Defensive branch: a parser/version mismatch that returns the wrong
    // address family for input node:net already classified as IPv6.
    mockIpaddrParse.mockImplementationOnce(() => ({ kind: () => 'ipv4' }) as ReturnType<typeof actualIpaddrParse>);
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(true);
  });
});

describe('validatePublicUrl', () => {
  beforeEach(() => {
    mockDnsLookup.mockReset();
  });

  it('allows public IP addresses', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(validatePublicUrl(new URL('https://example.com/cred'))).resolves.toBeUndefined();
  });

  it('rejects hostname resolving to localhost', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects hostname resolving to private network', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects hostname resolving to cloud metadata IP', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects IP literal pointing to private range', async () => {
    await expect(validatePublicUrl(new URL('http://127.0.0.1/cred'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('rejects bracketed IPv6 loopback literal as private, without a DNS call', async () => {
    await expect(validatePublicUrl(new URL('http://[::1]/cred'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('rejects bracketed IPv6 unique-local literal as private, without a DNS call', async () => {
    await expect(validatePublicUrl(new URL('http://[fd00::1]/cred'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it.each([
    ['loopback (::127.0.0.1)', '[::127.0.0.1]'],
    ['cloud metadata (::169.254.169.254)', '[::169.254.169.254]'],
  ])('rejects a bracketed IPv4-compatible IPv6 literal wrapping a %s address', async (_label, hostLiteral) => {
    await expect(validatePublicUrl(new URL(`http://${hostLiteral}/cred`))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('accepts a bracketed public IPv6 literal without a DNS call', async () => {
    await expect(validatePublicUrl(new URL('http://[2606:4700:4700::1111]/cred'))).resolves.toBeUndefined();
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it.each([
    ['4000::/3', '[4000::1]'],
    ['fe00::/9', '[fe00::1]'],
    ['100::/8', '[101::1]'],
    ['3ffe::/16 (decommissioned 6bone)', '[3ffe::1]'],
  ])(
    'rejects a bracketed IPv6 literal in unallocated/reserved space (%s), without a DNS call',
    async (_label, hostLiteral) => {
      await expect(validatePublicUrl(new URL(`http://${hostLiteral}/cred`))).rejects.toThrow(
        'uri must not point to a private or reserved network address',
      );
      expect(mockDnsLookup).not.toHaveBeenCalled();
    },
  );

  it('rejects a bracketed IPv4-mapped IPv6 literal wrapping a private address, without a DNS call', async () => {
    await expect(validatePublicUrl(new URL('http://[::ffff:127.0.0.1]/cred'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('accepts a bracketed IPv4-mapped IPv6 literal wrapping a public address, without a DNS call', async () => {
    await expect(validatePublicUrl(new URL('http://[::ffff:93.184.216.34]/cred'))).resolves.toBeUndefined();
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it.each([
    ['documentation (TEST-NET-1)', '192.0.2.1'],
    ['benchmarking', '198.18.0.1'],
    ['multicast', '224.0.0.1'],
    ['reserved', '240.0.0.1'],
  ])('rejects an IPv4 literal in the %s range', async (_label, address) => {
    await expect(validatePublicUrl(new URL(`http://${address}/cred`))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('accepts a plain public IPv4 literal without a DNS call', async () => {
    await expect(validatePublicUrl(new URL('http://93.184.216.34/cred'))).resolves.toBeUndefined();
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it.each([
    ['RFC1918 (10/8)', '10.0.0.1'],
    ['RFC1918 (172.16/12)', '172.16.0.1'],
    ['RFC1918 (192.168/16)', '192.168.0.1'],
    ['link-local / cloud metadata', '169.254.169.254'],
  ])('rejects an IPv4 literal in the %s range', async (_label, address) => {
    await expect(validatePublicUrl(new URL(`http://${address}/cred`))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('rejects when DNS resolution fails', async () => {
    mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(validatePublicUrl(new URL('https://nonexistent.invalid'))).rejects.toThrow(
      'uri hostname could not be resolved',
    );
  });

  it('preserves the underlying DNS error as the cause', async () => {
    const dnsError = new Error('ENOTFOUND');
    mockDnsLookup.mockRejectedValue(dnsError);
    let caught: unknown;
    try {
      await validatePublicUrl(new URL('https://nonexistent.invalid'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('uri hostname could not be resolved');
    expect((caught as Error).cause).toBe(dnsError);
  });

  it('rejects when DNS resolution returns no records', async () => {
    mockDnsLookup.mockResolvedValue([]);
    await expect(validatePublicUrl(new URL('https://empty.example.com'))).rejects.toThrow(
      'uri hostname could not be resolved',
    );
  });

  it('rejects IPv6 private resolved address', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '::1', family: 6 }]);
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects a hostname resolving to a mix of public and private addresses (public first)', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects a hostname resolving to a mix of private and public addresses (private first)', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '10.0.0.1', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects a resolved record whose claimed family disagrees with its address shape', async () => {
    // A private IPv4 address mislabelled with family: 6 must not slip
    // through by running the wrong (IPv6) predicate against a string that
    // isn't a parseable IPv6 address, which would otherwise return false.
    mockDnsLookup.mockResolvedValue([{ address: '10.0.0.1', family: 6 }]);
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects a resolved record whose address is neither valid IPv4 nor valid IPv6', async () => {
    mockDnsLookup.mockResolvedValue([{ address: 'not-an-ip-address', family: 4 }]);
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects a resolved record with family: 0, even when the address itself is public', async () => {
    // `record.family` is typed as a bare `number`; family 0 is a documented
    // possible (resolver-bug) value. Using a PUBLIC address here means this
    // test would pass under a weaker "classify by shape only, ignore
    // record.family" implementation, which is not what is required: the
    // derived family must also AGREE with the claimed family, and 0 can
    // never agree with a real derived family of 4 or 6.
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 0 }]);
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('accepts a hostname whose every resolved address is public', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ]);
    await expect(validatePublicUrl(new URL('https://example.com/cred'))).resolves.toBeUndefined();
  });

  it('calls dns.lookup with { all: true } so every advertised address is checked', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await validatePublicUrl(new URL('https://example.com/cred'));
    expect(mockDnsLookup).toHaveBeenCalledWith('example.com', { all: true });
  });
});
