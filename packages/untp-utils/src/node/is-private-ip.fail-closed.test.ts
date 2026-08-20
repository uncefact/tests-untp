import { jest } from '@jest/globals';

// These cases pin the fail-closed branches of the IP predicates: when
// `ipaddr.js` cannot parse a value that `node:net` accepted, or reports an
// unexpected kind, the predicates must classify the address as private
// rather than let it through. Only a mocked parser can reach those
// branches, so this file (unlike is-private-ip.test.ts) replaces
// `ipaddr.js` per test.
const parse = jest.fn();

jest.unstable_mockModule('ipaddr.js', () => ({
  default: { parse },
}));

const { isPrivateIpv4, isPrivateIpv6 } = await import('./is-private-ip.js');

beforeEach(() => {
  parse.mockReset();
});

describe('isPrivateIpv4 fail-closed', () => {
  it('treats an address as private when ipaddr.js cannot parse a value node:net accepted', () => {
    parse.mockImplementation(() => {
      throw new Error('parser/grammar skew');
    });
    expect(isPrivateIpv4('1.1.1.1')).toBe(true);
  });
});

describe('isPrivateIpv6 fail-closed', () => {
  it('treats an address as private when ipaddr.js cannot parse a value node:net accepted', () => {
    parse.mockImplementation(() => {
      throw new Error('parser/grammar skew');
    });
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(true);
  });

  it('treats an address as private when ipaddr.js reports a non-ipv6 kind for an IPv6-shaped input', () => {
    parse.mockReturnValue({ kind: () => 'ipv4' });
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(true);
  });
});
