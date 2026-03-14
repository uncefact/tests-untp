import { makeBridge } from '../../make-bridge.js';
import { diaV060Spec } from './versions/v060.js';
import { diaV061Spec } from './versions/v061.js';
import {
  createOrganisation,
  createProduct,
  createFacility,
  createConformityInput,
  createResolvedEntities,
} from '../../__fixtures__/entities.js';
import type { VersionSpec } from '../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', diaV060Spec],
  ['v0.6.1', diaV061Spec],
];

describe.each(versions)('buildDiaSubject (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  // ── credentialSubject root structure ─────────────────────────────────────────

  describe('credentialSubject root', () => {
    it('sets type to RegisteredIdentity', () => {
      const subject = bridge.buildSubject(createResolvedEntities());
      expect(subject.type).toEqual(['RegisteredIdentity']);
    });

    it('maps organisation id', () => {
      const subject = bridge.buildSubject(
        createResolvedEntities({ organisation: createOrganisation({ id: 'did:web:example.com:org:1' }) }),
      );
      expect(subject.id).toBe('did:web:example.com:org:1');
    });

    it('maps organisation name', () => {
      const subject = bridge.buildSubject(
        createResolvedEntities({ organisation: createOrganisation({ name: 'ACME Corp' }) }),
      );
      expect(subject.name).toBe('ACME Corp');
    });

    it('includes registeredId and idScheme when primaryIdentifier is present', () => {
      const subject = bridge.buildSubject(createResolvedEntities());
      expect(subject.registeredId).toBe('9520123456788');
      expect(subject.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'https://id.gs1.org/01/',
        name: 'Global Trade Item Number (GTIN)',
      });
    });

    it('omits registeredId and idScheme when primaryIdentifier is absent', () => {
      const subject = bridge.buildSubject(
        createResolvedEntities({ organisation: createOrganisation({ primaryIdentifier: null }) }),
      );
      expect(subject.registeredId).toBeUndefined();
      expect(subject.idScheme).toBeUndefined();
    });

    it('maps undefined id and name when organisation is absent', () => {
      const subject = bridge.buildSubject(createResolvedEntities({ organisation: undefined }));
      expect(subject.id).toBeUndefined();
      expect(subject.name).toBeUndefined();
    });
  });

  // ── silently ignored fields ──────────────────────────────────────────────────

  describe('silently ignored inputs', () => {
    it('does not include facility in subject', () => {
      const subject = bridge.buildSubject(createResolvedEntities({ facility: createFacility() }));
      expect(subject.facility).toBeUndefined();
    });

    it('does not include product in subject', () => {
      const subject = bridge.buildSubject(createResolvedEntities({ product: createProduct() }));
      expect(subject.product).toBeUndefined();
    });

    it('does not include conformityClaim in subject', () => {
      const subject = bridge.buildSubject(createResolvedEntities({ conformity: [createConformityInput()] }));
      expect(subject.conformityClaim).toBeUndefined();
    });
  });
});
