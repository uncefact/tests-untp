import { jest } from '@jest/globals';
import {
  InvalidUrlError,
  PrivateAddressError,
  PrivateHostnameError,
  ResolutionEmptyError,
  ResolutionFailedError,
  UrlValidationError,
} from './errors.js';

const lookup = jest.fn();

jest.unstable_mockModule('node:dns/promises', () => ({
  default: { lookup },
  lookup,
}));

const { validatePublicUrl } = await import('./validate-public-url.js');

describe('validatePublicUrl', () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  describe('URL parsing', () => {
    it('throws InvalidUrlError when the string is not a parseable URL', async () => {
      await expect(validatePublicUrl('not a url')).rejects.toBeInstanceOf(InvalidUrlError);
      await expect(validatePublicUrl('not a url')).rejects.toMatchObject({
        code: 'url.invalid',
        received: 'not a url',
      });
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('scheme', () => {
    it('throws UnsupportedSchemeError for an unallowed scheme', async () => {
      await expect(validatePublicUrl('ftp://example.com/path')).rejects.toMatchObject({
        name: 'UnsupportedSchemeError',
        code: 'url.unsupported-scheme',
        received: 'ftp',
      });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('accepts a caller-supplied allowedSchemes list', async () => {
      lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as never);
      await expect(validatePublicUrl('wss://example.com/ws', { allowedSchemes: ['wss', 'ws'] })).resolves.toEqual({
        address: '1.1.1.1',
        family: 4,
      });
    });

    it('reports canonical scheme details on the error', async () => {
      await expect(validatePublicUrl('ftp://example.com/')).rejects.toMatchObject({
        received: 'ftp',
        expected: ['http', 'https'],
        remediation: 'Use one of: http, https.',
      });
    });

    it('compares schemes case-insensitively', async () => {
      lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as never);
      await expect(validatePublicUrl('HTTPS://example.com/')).resolves.toEqual({
        address: '1.1.1.1',
        family: 4,
      });
    });
  });

  describe('hostname', () => {
    it('rejects localhost without DNS lookup', async () => {
      await expect(validatePublicUrl('http://localhost/path')).rejects.toBeInstanceOf(PrivateHostnameError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects .internal suffix without DNS lookup', async () => {
      await expect(validatePublicUrl('http://db.internal/')).rejects.toBeInstanceOf(PrivateHostnameError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a literal private IPv4 in the URL without DNS lookup', async () => {
      await expect(validatePublicUrl('http://10.0.0.1/')).rejects.toBeInstanceOf(PrivateHostnameError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a literal IPv6 loopback in the URL without DNS lookup', async () => {
      await expect(validatePublicUrl('http://[::1]/')).rejects.toBeInstanceOf(PrivateHostnameError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('returns the literal IP for a public IPv4 host without calling DNS', async () => {
      await expect(validatePublicUrl('http://1.1.1.1/')).resolves.toEqual({ address: '1.1.1.1', family: 4 });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('returns the literal IP for a public IPv6 host without calling DNS', async () => {
      await expect(validatePublicUrl('http://[2606:4700:4700::1111]/')).resolves.toEqual({
        address: '2606:4700:4700::1111',
        family: 6,
      });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a literal 0.0.0.0 host without DNS lookup', async () => {
      await expect(validatePublicUrl('http://0.0.0.0/')).rejects.toBeInstanceOf(PrivateHostnameError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects userinfo@host smuggling where the host is private', async () => {
      // `URL` discards the `evil.com@` userinfo; pin the regression.
      await expect(validatePublicUrl('http://evil.com@127.0.0.1/')).rejects.toMatchObject({
        name: 'PrivateHostnameError',
        received: '127.0.0.1',
      });
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('DNS resolution', () => {
    it('throws ResolutionFailedError when dns.lookup rejects', async () => {
      lookup.mockRejectedValue(new Error('ENOTFOUND example.com') as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toMatchObject({
        name: 'ResolutionFailedError',
        code: 'url.resolution-failed',
        received: 'ENOTFOUND example.com',
      });
    });

    it('throws ResolutionEmptyError when the resolver returns no records', async () => {
      lookup.mockResolvedValue([] as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toBeInstanceOf(ResolutionEmptyError);
    });

    it('passes the family option through to dns.lookup with all: true', async () => {
      lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as never);
      await validatePublicUrl('https://example.com/', { family: 4 });
      expect(lookup).toHaveBeenCalledWith('example.com', { family: 4, all: true });
    });

    it('defaults the family option to 0 (any)', async () => {
      lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as never);
      await validatePublicUrl('https://example.com/');
      expect(lookup).toHaveBeenCalledWith('example.com', { family: 0, all: true });
    });

    it('throws ResolutionFailedError when dns returns an unsupported family', async () => {
      lookup.mockResolvedValue([{ address: 'whatever', family: 7 }] as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toBeInstanceOf(ResolutionFailedError);
    });
  });

  describe('rebind defence', () => {
    it('rejects a hostname that resolves to AWS metadata', async () => {
      lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);
      await expect(validatePublicUrl('https://metadata.attacker.example/')).rejects.toMatchObject({
        name: 'PrivateAddressError',
        code: 'url.private-address',
        resolvedAddresses: ['169.254.169.254'],
      });
    });

    it('rejects a hostname that resolves to an RFC 1918 address', async () => {
      lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);
      await expect(validatePublicUrl('https://internal.attacker.example/')).rejects.toMatchObject({
        name: 'PrivateAddressError',
        resolvedAddresses: ['10.0.0.1'],
      });
    });

    it('rejects a hostname that resolves to an IPv6 loopback', async () => {
      lookup.mockResolvedValue([{ address: '::1', family: 6 }] as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toBeInstanceOf(PrivateAddressError);
    });

    it('rejects a hostname that resolves to an IPv6 unique-local address', async () => {
      lookup.mockResolvedValue([{ address: 'fc00::1', family: 6 }] as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toBeInstanceOf(PrivateAddressError);
    });

    it('rejects a hostname that resolves to an IPv4-mapped private IPv6 address', async () => {
      lookup.mockResolvedValue([{ address: '::ffff:10.0.0.1', family: 6 }] as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toBeInstanceOf(PrivateAddressError);
    });

    it('rejects when any A or AAAA record is private even if others are public', async () => {
      lookup.mockResolvedValue([
        { address: '1.1.1.1', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ] as never);
      await expect(validatePublicUrl('https://mixed.attacker.example/')).rejects.toMatchObject({
        name: 'PrivateAddressError',
        resolvedAddresses: ['169.254.169.254'],
      });
    });

    it('returns the first resolved IP so callers can use it as the connect target', async () => {
      lookup.mockResolvedValue([
        { address: '1.1.1.1', family: 4 },
        { address: '8.8.8.8', family: 4 },
      ] as never);
      await expect(validatePublicUrl('https://example.com/')).resolves.toEqual({ address: '1.1.1.1', family: 4 });
    });
  });

  describe('hierarchy', () => {
    it('every concrete error extends UrlValidationError', async () => {
      await expect(validatePublicUrl('not a url')).rejects.toBeInstanceOf(UrlValidationError);
      lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toBeInstanceOf(UrlValidationError);
    });
  });
});
