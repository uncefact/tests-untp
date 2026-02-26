const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock('@uncefact/untp-ri-services/logging', () => ({
  createLogger: () => ({ child: () => mockLogger }),
}));

import { extractGroupClaim, type GroupClaimConfig } from './group-claim';

const keycloakConfig: GroupClaimConfig = { claimName: 'groups', claimFormat: 'array_first' };
const zitadelConfig: GroupClaimConfig = {
  claimName: 'urn:zitadel:iam:user:resourceowner:id',
  claimFormat: 'string',
};

describe('extractGroupClaim', () => {
  describe('array_first format', () => {
    it('extracts first group from array', () => {
      const payload = { groups: ['/acme-corp'] };
      expect(extractGroupClaim(payload, keycloakConfig)).toBe('/acme-corp');
    });

    it('extracts first group when multiple present', () => {
      const payload = { groups: ['/acme-corp', '/other-group'] };
      expect(extractGroupClaim(payload, keycloakConfig)).toBe('/acme-corp');
    });

    it('returns null when claim is missing', () => {
      expect(extractGroupClaim({}, keycloakConfig)).toBeNull();
    });

    it('returns null when claim is null', () => {
      expect(extractGroupClaim({ groups: null }, keycloakConfig)).toBeNull();
    });

    it('returns null when array is empty', () => {
      expect(extractGroupClaim({ groups: [] }, keycloakConfig)).toBeNull();
    });

    it('returns null when first element is not a string', () => {
      expect(extractGroupClaim({ groups: [123] }, keycloakConfig)).toBeNull();
    });
  });

  describe('string format', () => {
    it('extracts string claim value', () => {
      const payload = { 'urn:zitadel:iam:user:resourceowner:id': 'org-123' };
      expect(extractGroupClaim(payload, zitadelConfig)).toBe('org-123');
    });

    it('returns null when claim is not a string', () => {
      const payload = { 'urn:zitadel:iam:user:resourceowner:id': 42 };
      expect(extractGroupClaim(payload, zitadelConfig)).toBeNull();
    });

    it('returns null when claim is missing', () => {
      expect(extractGroupClaim({}, zitadelConfig)).toBeNull();
    });
  });
});
