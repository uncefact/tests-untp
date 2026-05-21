import { jest } from '@jest/globals';
import { NodeUrlValidationCode } from './codes.js';

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
    it('emits an InvalidUrl error when the string is not a parseable URL', async () => {
      const outcome = await validatePublicUrl('not a url');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.InvalidUrl,
          received: 'not a url',
        }),
      );
      expect(outcome.value).toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('scheme', () => {
    it('rejects URLs whose scheme is not in the default allow list', async () => {
      const outcome = await validatePublicUrl('ftp://example.com/path');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.UnsupportedScheme,
          received: 'ftp:',
        }),
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('accepts a caller-supplied allowedSchemes list', async () => {
      lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as never);

      const outcome = await validatePublicUrl('wss://example.com/ws', {
        allowedSchemes: ['wss:', 'ws:'],
      });

      expect(outcome.errors).toEqual([]);
      expect(outcome.value).toEqual({ address: '1.1.1.1', family: 4 });
    });

    it('compares schemes case-insensitively', async () => {
      lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as never);

      const outcome = await validatePublicUrl('HTTPS://example.com/');

      expect(outcome.errors).toEqual([]);
    });
  });

  describe('hostname', () => {
    it('rejects localhost without DNS lookup', async () => {
      const outcome = await validatePublicUrl('http://localhost/path');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateHostname,
          received: 'localhost',
        }),
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects .internal suffix without DNS lookup', async () => {
      const outcome = await validatePublicUrl('http://db.internal/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateHostname,
        }),
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a literal private IPv4 in the URL without DNS lookup', async () => {
      const outcome = await validatePublicUrl('http://10.0.0.1/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateHostname,
        }),
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a literal IPv6 loopback in the URL without DNS lookup', async () => {
      const outcome = await validatePublicUrl('http://[::1]/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateHostname,
        }),
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('returns the literal IP for a public IPv4 host without calling DNS', async () => {
      const outcome = await validatePublicUrl('http://1.1.1.1/');

      expect(outcome.errors).toEqual([]);
      expect(outcome.value).toEqual({ address: '1.1.1.1', family: 4 });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('returns the literal IP for a public IPv6 host without calling DNS', async () => {
      const outcome = await validatePublicUrl('http://[2606:4700:4700::1111]/');

      expect(outcome.errors).toEqual([]);
      expect(outcome.value).toEqual({ address: '2606:4700:4700::1111', family: 6 });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a literal 0.0.0.0 host without DNS lookup', async () => {
      const outcome = await validatePublicUrl('http://0.0.0.0/');

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: NodeUrlValidationCode.PrivateHostname }));
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects userinfo@host smuggling where the host is private', async () => {
      // `URL` discards the `evil.com@` userinfo and leaves the hostname as
      // `127.0.0.1`. This is the canonical SSRF bypass; pin the regression.
      const outcome = await validatePublicUrl('http://evil.com@127.0.0.1/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateHostname,
          received: '127.0.0.1',
        }),
      );
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('DNS resolution', () => {
    it('emits a ResolutionFailed error when dns.lookup rejects', async () => {
      lookup.mockRejectedValue(new Error('ENOTFOUND example.com') as never);

      const outcome = await validatePublicUrl('https://example.com/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.ResolutionFailed,
          received: 'ENOTFOUND example.com',
        }),
      );
      expect(outcome.value).toBeUndefined();
    });

    it('emits a ResolutionEmpty error when the resolver returns no records', async () => {
      lookup.mockResolvedValue([] as never);

      const outcome = await validatePublicUrl('https://example.com/');

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: NodeUrlValidationCode.ResolutionEmpty }));
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

    it('emits a ResolutionFailed error when dns returns an unsupported family', async () => {
      lookup.mockResolvedValue([{ address: 'whatever', family: 7 }] as never);

      const outcome = await validatePublicUrl('https://example.com/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.ResolutionFailed,
          received: { address: 'whatever', family: 7 },
        }),
      );
    });
  });

  describe('rebind defence', () => {
    it('rejects a hostname that resolves to AWS metadata', async () => {
      lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);

      const outcome = await validatePublicUrl('https://metadata.attacker.example/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateAddress,
          received: ['169.254.169.254'],
        }),
      );
      expect(outcome.value).toBeUndefined();
    });

    it('rejects a hostname that resolves to an RFC 1918 address', async () => {
      lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);

      const outcome = await validatePublicUrl('https://internal.attacker.example/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateAddress,
          received: ['10.0.0.1'],
        }),
      );
    });

    it('rejects a hostname that resolves to an IPv6 loopback', async () => {
      lookup.mockResolvedValue([{ address: '::1', family: 6 }] as never);

      const outcome = await validatePublicUrl('https://example.com/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateAddress,
          received: ['::1'],
        }),
      );
    });

    it('rejects a hostname that resolves to an IPv6 unique-local address', async () => {
      lookup.mockResolvedValue([{ address: 'fc00::1', family: 6 }] as never);

      const outcome = await validatePublicUrl('https://example.com/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateAddress,
          received: ['fc00::1'],
        }),
      );
    });

    it('rejects a hostname that resolves to an IPv4-mapped private IPv6 address', async () => {
      lookup.mockResolvedValue([{ address: '::ffff:10.0.0.1', family: 6 }] as never);

      const outcome = await validatePublicUrl('https://example.com/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateAddress,
          received: ['::ffff:10.0.0.1'],
        }),
      );
    });

    it('rejects when any A or AAAA record is private even if others are public', async () => {
      lookup.mockResolvedValue([
        { address: '1.1.1.1', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ] as never);

      const outcome = await validatePublicUrl('https://mixed.attacker.example/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: NodeUrlValidationCode.PrivateAddress,
          received: ['169.254.169.254'],
        }),
      );
      expect(outcome.value).toBeUndefined();
    });

    it('returns the first resolved IP so callers can use it as the connect target', async () => {
      // Connecting via outcome.value.address rather than the hostname is what
      // closes the DNS rebinding window: a subsequent lookup could return a
      // private IP, but the caller has already pinned a safe one from this
      // resolution pass.
      lookup.mockResolvedValue([
        { address: '1.1.1.1', family: 4 },
        { address: '8.8.8.8', family: 4 },
      ] as never);

      const outcome = await validatePublicUrl('https://example.com/');

      expect(outcome.errors).toEqual([]);
      expect(outcome.value).toEqual({ address: '1.1.1.1', family: 4 });
    });
  });
});
