const mockDnsLookup = jest.fn();
jest.mock('node:dns', () => ({
  promises: {
    lookup: (...args: unknown[]) => mockDnsLookup(...args),
  },
}));

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
    ['93.184.216.34', false],
    ['8.8.8.8', false],
    ['172.32.0.1', false],
    ['1.1.1.1', false],
  ])('returns %s for %s', (address, expected) => {
    expect(isPrivateIpv4(address)).toBe(expected);
  });

  it('returns false for invalid addresses', () => {
    expect(isPrivateIpv4('not-an-ip')).toBe(false);
    expect(isPrivateIpv4('256.0.0.1')).toBe(false);
    expect(isPrivateIpv4('1.2.3')).toBe(false);
  });
});

describe('isPrivateIpv6', () => {
  it.each([
    ['::1', true],
    ['fe80::1', true],
    ['fe80:0000::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:192.168.1.1', true],
    ['::ffff:93.184.216.34', false],
    ['2001:db8::1', false],
  ])('returns %s for %s', (address, expected) => {
    expect(isPrivateIpv6(address)).toBe(expected);
  });
});

describe('validatePublicUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows public IP addresses', async () => {
    mockDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await expect(validatePublicUrl(new URL('https://example.com/cred'))).resolves.toBeUndefined();
  });

  it('rejects hostname resolving to localhost', async () => {
    mockDnsLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects hostname resolving to private network', async () => {
    mockDnsLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 });
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('rejects hostname resolving to cloud metadata IP', async () => {
    mockDnsLookup.mockResolvedValue({ address: '169.254.169.254', family: 4 });
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

  it('rejects IPv6 loopback literal', async () => {
    await expect(validatePublicUrl(new URL('http://[::1]/cred'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });

  it('allows through when DNS resolution fails', async () => {
    mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(validatePublicUrl(new URL('https://nonexistent.invalid'))).resolves.toBeUndefined();
  });

  it('rejects IPv6 private resolved address', async () => {
    mockDnsLookup.mockResolvedValue({ address: '::1', family: 6 });
    await expect(validatePublicUrl(new URL('https://evil.example.com'))).rejects.toThrow(
      'uri must not point to a private or reserved network address',
    );
  });
});
