import { jest } from '@jest/globals';
import {
  InvalidUrlError,
  PrivateAddressError,
  PrivateHostnameError,
  ResolutionEmptyError,
  ResolutionFailedError,
  UrlValidationError,
} from './errors.js';
import type { PublicUrlLookup } from './validate-public-url.js';

const lookup = jest.fn();

jest.unstable_mockModule('node:dns/promises', () => ({
  default: { lookup },
  lookup,
}));

const { validatePublicUrl } = await import('./validate-public-url.js');

/**
 * The shape `validatePublicUrl` returns for a single validated address:
 * `address` / `family` repeat the first entry of `addresses`.
 */
function validated(address: string, family: 4 | 6) {
  return { address, family, addresses: [{ address, family }] };
}

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

    it('retains parse rejection when private addresses are allowed', async () => {
      await expect(validatePublicUrl('not a url', { allowPrivateAddresses: true })).rejects.toBeInstanceOf(
        InvalidUrlError,
      );
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
      await expect(validatePublicUrl('wss://example.com/ws', { allowedSchemes: ['wss', 'ws'] })).resolves.toEqual(
        validated('1.1.1.1', 4),
      );
    });

    it('retains scheme rejection when private addresses are allowed', async () => {
      await expect(validatePublicUrl('ftp://example.com/path', { allowPrivateAddresses: true })).rejects.toMatchObject({
        name: 'UnsupportedSchemeError',
      });
      expect(lookup).not.toHaveBeenCalled();
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
      await expect(validatePublicUrl('HTTPS://example.com/')).resolves.toEqual(validated('1.1.1.1', 4));
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
      await expect(validatePublicUrl('http://1.1.1.1/')).resolves.toEqual(validated('1.1.1.1', 4));
      expect(lookup).not.toHaveBeenCalled();
    });

    it('returns the literal IP for a public IPv6 host without calling DNS', async () => {
      await expect(validatePublicUrl('http://[2606:4700:4700::1111]/')).resolves.toEqual(
        validated('2606:4700:4700::1111', 6),
      );
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

    it.each([undefined, false, 'true'])(
      'keeps private literals strict when allowPrivateAddresses is %p',
      async (option) => {
        await expect(
          validatePublicUrl('http://10.0.0.1/', { allowPrivateAddresses: option as never }),
        ).rejects.toBeInstanceOf(PrivateHostnameError);
        expect(lookup).not.toHaveBeenCalled();
      },
    );

    it('rejects an empty hostname as malformed input even when private addresses are allowed', async () => {
      await expect(
        validatePublicUrl('file:///', { allowedSchemes: ['file'], allowPrivateAddresses: true }),
      ).rejects.toBeInstanceOf(InvalidUrlError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it.each(['localhost', 'db.internal'])(
      'resolves local names when private addresses are allowed',
      async (hostname) => {
        lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);

        await expect(validatePublicUrl(`http://${hostname}/`, { allowPrivateAddresses: true })).resolves.toEqual(
          validated('10.0.0.5', 4),
        );
        expect(lookup).toHaveBeenCalledWith(hostname, { family: 0, all: true });
      },
    );

    it.each([
      ['127.0.0.1', 'http://127.0.0.1/'],
      ['169.254.169.254', 'http://169.254.169.254/'],
      ['224.0.0.1', 'http://224.0.0.1/'],
      ['0.0.0.0', 'http://0.0.0.0/'],
      ['::1', 'http://[::1]/'],
      ['fc00::1', 'http://[fc00::1]/'],
      ['::ffff:10.0.0.1', 'http://[::ffff:10.0.0.1]/'],
    ])('allows the non-public literal %s without DNS when opted in', async (_address, url) => {
      const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
      await expect(validatePublicUrl(url, { allowPrivateAddresses: true })).resolves.toEqual(
        validated(hostname, url.includes('[') ? 6 : 4),
      );
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('DNS resolution', () => {
    it('uses a supplied lookup callback while still validating its addresses', async () => {
      const suppliedLookup = jest.fn<PublicUrlLookup>().mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

      await expect(validatePublicUrl('https://example.com/', { lookup: suppliedLookup })).rejects.toBeInstanceOf(
        PrivateAddressError,
      );
      expect(suppliedLookup).toHaveBeenCalledWith('example.com', { family: 0, all: true });
    });

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

    it('rejects a record whose address does not parse as an IP', async () => {
      lookup.mockResolvedValue([{ address: 'not-an-ip-address', family: 4 }] as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toThrow(ResolutionFailedError);
    });

    it('rejects a record whose claimed family contradicts its address', async () => {
      lookup.mockResolvedValue([{ address: '10.0.0.1', family: 6 }] as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toThrow(ResolutionFailedError);
    });

    it('requires family agreement even when the address itself is public', async () => {
      lookup.mockResolvedValue([{ address: '93.184.216.34', family: 0 }] as never);
      await expect(validatePublicUrl('https://example.com/')).rejects.toThrow(ResolutionFailedError);
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

    it('retains DNS rejection when private addresses are allowed', async () => {
      const dnsError = new Error('EAI_AGAIN');
      lookup.mockRejectedValue(dnsError as never);

      await expect(validatePublicUrl('https://example.com/', { allowPrivateAddresses: true })).rejects.toMatchObject({
        name: 'ResolutionFailedError',
        cause: dnsError,
      });
    });

    it('retains empty resolution when private addresses are allowed', async () => {
      lookup.mockResolvedValue([] as never);

      await expect(validatePublicUrl('https://example.com/', { allowPrivateAddresses: true })).rejects.toBeInstanceOf(
        ResolutionEmptyError,
      );
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

    it('returns every validated public record so callers can use them all as connect targets', async () => {
      lookup.mockResolvedValue([
        { address: '1.1.1.1', family: 4 },
        { address: '8.8.8.8', family: 4 },
      ] as never);
      await expect(validatePublicUrl('https://example.com/')).resolves.toEqual({
        address: '1.1.1.1',
        family: 4,
        addresses: [
          { address: '1.1.1.1', family: 4 },
          { address: '8.8.8.8', family: 4 },
        ],
      });
    });

    it('allows private and public records and returns them all when opted in', async () => {
      lookup.mockResolvedValue([
        { address: '10.0.0.1', family: 4 },
        { address: '1.1.1.1', family: 4 },
      ] as never);

      await expect(validatePublicUrl('https://mixed.example/', { allowPrivateAddresses: true })).resolves.toEqual({
        address: '10.0.0.1',
        family: 4,
        addresses: [
          { address: '10.0.0.1', family: 4 },
          { address: '1.1.1.1', family: 4 },
        ],
      });
    });

    // The dual-stack `localhost` case that CI hit: only one of the two
    // addresses has a listener, so the caller needs both to reach it.
    it('returns both records for a dual-stack loopback name when opted in', async () => {
      lookup.mockResolvedValue([
        { address: '::1', family: 6 },
        { address: '127.0.0.1', family: 4 },
      ] as never);

      await expect(validatePublicUrl('http://localhost/', { allowPrivateAddresses: true })).resolves.toEqual({
        address: '::1',
        family: 6,
        addresses: [
          { address: '::1', family: 6 },
          { address: '127.0.0.1', family: 4 },
        ],
      });
    });

    it('returns every public record in strict mode', async () => {
      lookup.mockResolvedValue([
        { address: '1.1.1.1', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ] as never);

      await expect(validatePublicUrl('https://example.com/')).resolves.toEqual({
        address: '1.1.1.1',
        family: 4,
        addresses: [
          { address: '1.1.1.1', family: 4 },
          { address: '2606:4700:4700::1111', family: 6 },
        ],
      });
    });

    it('still throws when a later record is private in strict mode', async () => {
      lookup.mockResolvedValue([
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ] as never);

      await expect(validatePublicUrl('https://example.com/')).rejects.toBeInstanceOf(PrivateAddressError);
    });

    it('leads with a public first record rather than preferring a later private record when opted in', async () => {
      lookup.mockResolvedValue([
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ] as never);

      await expect(validatePublicUrl('https://mixed.example/', { allowPrivateAddresses: true })).resolves.toEqual({
        address: '1.1.1.1',
        family: 4,
        addresses: [
          { address: '1.1.1.1', family: 4 },
          { address: '10.0.0.1', family: 4 },
        ],
      });
    });

    it('checks every record for contradictory metadata in relaxed mode', async () => {
      lookup.mockResolvedValue([
        { address: '10.0.0.1', family: 4 },
        { address: 'not-an-ip', family: 4 },
      ] as never);

      await expect(validatePublicUrl('https://mixed.example/', { allowPrivateAddresses: true })).rejects.toBeInstanceOf(
        ResolutionFailedError,
      );
    });

    it('retains family validation and lookup hints in relaxed mode', async () => {
      lookup.mockResolvedValue([{ address: '10.0.0.1', family: 6 }] as never);

      await expect(
        validatePublicUrl('https://mixed.example/', { allowPrivateAddresses: true, family: 6 }),
      ).rejects.toBeInstanceOf(ResolutionFailedError);
      expect(lookup).toHaveBeenCalledWith('mixed.example', { family: 6, all: true });
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
