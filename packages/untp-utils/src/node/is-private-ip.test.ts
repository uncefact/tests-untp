import { isPrivateHostname, isPrivateIpv4, isPrivateIpv6 } from './is-private-ip.js';

describe('isPrivateIpv4', () => {
  it.each([['1.1.1.1'], ['8.8.8.8'], ['151.101.0.1']])(
    'returns false for the unmistakeably public address %s',
    (addr) => {
      expect(isPrivateIpv4(addr)).toBe(false);
    },
  );

  it.each([
    ['0.0.0.0'], // unspecified
    ['10.0.0.1'], // RFC 1918
    ['10.255.255.255'],
    ['100.64.0.1'], // CGNAT
    ['127.0.0.1'], // loopback
    ['127.255.255.255'],
    ['169.254.0.1'], // link-local
    ['169.254.169.254'], // cloud metadata (AWS/GCP/Azure)
    ['172.16.0.1'], // RFC 1918
    ['172.31.255.255'],
    ['192.168.0.1'], // RFC 1918
    ['192.168.255.255'],
    ['224.0.0.1'], // multicast
    ['255.255.255.255'], // broadcast
    ['198.18.0.1'], // benchmarking
    ['203.0.113.1'], // TEST-NET-3 (reserved)
    ['100.100.100.200'], // Alibaba Cloud metadata (publicly routable, but explicitly blocked)
  ])('returns true for the private/reserved/metadata address %s', (addr) => {
    expect(isPrivateIpv4(addr)).toBe(true);
  });

  it('returns false for non-IPv4 input', () => {
    expect(isPrivateIpv4('not an ip')).toBe(false);
    expect(isPrivateIpv4('::1')).toBe(false);
    expect(isPrivateIpv4('')).toBe(false);
  });
});

describe('isPrivateIpv6', () => {
  it.each([
    ['2606:4700:4700::1111'], // Cloudflare public DNS
    ['2001:4860:4860::8888'], // Google public DNS
  ])('returns false for the unmistakeably public address %s', (addr) => {
    expect(isPrivateIpv6(addr)).toBe(false);
  });

  it.each([
    ['::'], // unspecified
    ['::1'], // loopback
    ['fe80::1'], // link-local
    ['fc00::1'], // unique local
    ['fd00::1'], // unique local
    ['ff02::1'], // multicast
    ['2001:db8::1'], // documentation / reserved
    ['2002::1'], // 6to4
  ])('returns true for the non-public address %s', (addr) => {
    expect(isPrivateIpv6(addr)).toBe(true);
  });

  it('treats IPv4-mapped IPv6 addresses by their embedded IPv4 status', () => {
    expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIpv6('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateIpv6('::ffff:1.1.1.1')).toBe(false);
  });

  it('returns false for non-IPv6 input', () => {
    expect(isPrivateIpv6('not an ip')).toBe(false);
    expect(isPrivateIpv6('10.0.0.1')).toBe(false);
    expect(isPrivateIpv6('')).toBe(false);
  });
});

describe('isPrivateHostname', () => {
  it.each([
    [''],
    ['localhost'],
    ['LOCALHOST'],
    ['foo.localhost'],
    ['bar.local'],
    ['printer.local.'], // trailing dot is stripped
    ['db.internal'],
    ['svc.intranet'],
    ['file-server.lan'],
    ['router.home'],
    ['app.corp'],
    ['vault.private'],
  ])('returns true for the private hostname %s', (host) => {
    expect(isPrivateHostname(host)).toBe(true);
  });

  it.each([['example.com'], ['api.cloudflare.com'], ['google.com.']])(
    'returns false for the public hostname %s',
    (host) => {
      expect(isPrivateHostname(host)).toBe(false);
    },
  );

  it('defers to IP predicates when the hostname is an IP literal', () => {
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
    expect(isPrivateHostname('169.254.169.254')).toBe(true);
    expect(isPrivateHostname('::1')).toBe(true);
    expect(isPrivateHostname('1.1.1.1')).toBe(false);
    expect(isPrivateHostname('2606:4700:4700::1111')).toBe(false);
  });
});
