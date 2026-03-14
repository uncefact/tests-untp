import { makeBridge } from '../../../../make-bridge.js';
import { diaV060Spec } from './index.js';
import { diaV061Spec } from '../v061/index.js';
import {
  createOrganisation,
  createProduct,
  createFacility,
  createConformityInput,
  createBridgeEntities,
} from '../../../../__fixtures__/entities.js';
import type { VersionSpec } from '../../../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', diaV060Spec],
  ['v0.6.1', diaV061Spec],
];

describe.each(versions)('buildDiaSubject (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  // ── credentialSubject root structure ─────────────────────────────────────────

  describe('credentialSubject root', () => {
    it('sets type to RegisteredIdentity', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.type).toEqual(['RegisteredIdentity']);
    });

    it('maps organisation id', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: createOrganisation({ id: 'did:web:example.com:org:1' }) }),
      );
      expect(subject.id).toBe('did:web:example.com:org:1');
    });

    it('maps organisation name', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: createOrganisation({ name: 'ACME Corp' }) }),
      );
      expect(subject.name).toBe('ACME Corp');
    });

    it('includes registeredId and idScheme when primaryIdentifier is present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.registeredId).toBe('9520123456788');
      expect(subject.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'https://id.gs1.org/01/',
        name: 'Global Trade Item Number (GTIN)',
      });
    });

    it('omits registeredId and idScheme when primaryIdentifier is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: createOrganisation({ primaryIdentifier: null }) }),
      );
      expect(subject.registeredId).toBeUndefined();
      expect(subject.idScheme).toBeUndefined();
    });

    it('maps undefined id and name when no entity is provided', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: undefined, facility: undefined, product: undefined }),
      );
      expect(subject.id).toBeUndefined();
      expect(subject.name).toBeUndefined();
    });
  });

  // ── entity fallback priority ───────────────────────────────────────────────

  describe('entity fallback priority', () => {
    it('uses facility when organisation is absent', () => {
      const facility = createFacility({ id: 'did:web:example.com:facility:99', name: 'My Facility' });
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: undefined, facility, product: undefined }),
      );
      expect(subject.id).toBe('did:web:example.com:facility:99');
      expect(subject.name).toBe('My Facility');
      expect(subject.registeredId).toBe('4012345000009');
    });

    it('uses product when organisation and facility are absent', () => {
      const product = createProduct({ id: 'did:web:example.com:product:42', name: 'My Product' });
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: undefined, facility: undefined, product }),
      );
      expect(subject.id).toBe('did:web:example.com:product:42');
      expect(subject.name).toBe('My Product');
      expect(subject.registeredId).toBe('9520123456788');
    });

    it('prefers organisation over facility when both are provided', () => {
      const organisation = createOrganisation({ id: 'did:web:org', name: 'Org' });
      const facility = createFacility({ id: 'did:web:facility', name: 'Facility' });
      const subject = bridge.buildSubject(createBridgeEntities({ organisation, facility }));
      expect(subject.id).toBe('did:web:org');
      expect(subject.name).toBe('Org');
    });

    it('prefers organisation over product when both are provided', () => {
      const organisation = createOrganisation({ id: 'did:web:org', name: 'Org' });
      const product = createProduct({ id: 'did:web:product', name: 'Product' });
      const subject = bridge.buildSubject(createBridgeEntities({ organisation, facility: undefined, product }));
      expect(subject.id).toBe('did:web:org');
      expect(subject.name).toBe('Org');
    });

    it('prefers facility over product when organisation is absent', () => {
      const facility = createFacility({ id: 'did:web:facility', name: 'Facility' });
      const product = createProduct({ id: 'did:web:product', name: 'Product' });
      const subject = bridge.buildSubject(createBridgeEntities({ organisation: undefined, facility, product }));
      expect(subject.id).toBe('did:web:facility');
      expect(subject.name).toBe('Facility');
    });
  });

  // ── registerType mapping ────────────────────────────────────────────────────

  describe('registerType mapping', () => {
    it('sets registerType to Business when built from organisation', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.registerType).toBe('Business');
    });

    it('sets registerType to Facility when built from facility', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: undefined, facility: createFacility(), product: undefined }),
      );
      expect(subject.registerType).toBe('Facility');
    });

    it('sets registerType to Product when built from product', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: undefined, facility: undefined, product: createProduct() }),
      );
      expect(subject.registerType).toBe('Product');
    });

    it('omits registerType when no entity is provided', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: undefined, facility: undefined, product: undefined }),
      );
      expect(subject.registerType).toBeUndefined();
    });
  });

  // ── silently ignored fields ──────────────────────────────────────────────────

  describe('silently ignored inputs', () => {
    it('does not include conformityClaim in subject', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      expect(subject.conformityClaim).toBeUndefined();
    });
  });
});
