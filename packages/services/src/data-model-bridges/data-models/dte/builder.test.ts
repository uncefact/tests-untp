import { makeBridge } from '../../make-bridge.js';
import { dteV060Spec } from './versions/v060.js';
import { dteV061Spec } from './versions/v061.js';
import {
  createOrganisation,
  createProduct,
  createFacility,
  createConformityInput,
  createBridgeEntities,
} from '../../__fixtures__/entities.js';
import type { VersionSpec } from '../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dteV060Spec],
  ['v0.6.1', dteV061Spec],
];

describe.each(versions)('buildDteSubject (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  // ── credentialSubject root structure ─────────────────────────────────────────

  describe('credentialSubject root', () => {
    it('sets type to Event', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.type).toEqual(['Event']);
    });

    it('includes epcList when product is present', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct() }));
      expect(subject.epcList).toBeDefined();
    });

    it('omits epcList when product is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: undefined }));
      expect(subject.epcList).toBeUndefined();
    });
  });

  // ── epcList item ─────────────────────────────────────────────────────────────

  describe('epcList item', () => {
    it('builds a single-item epcList', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct() }));
      const epcList = subject.epcList as unknown[];
      expect(epcList).toHaveLength(1);
    });

    it('sets item type to Item', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct() }));
      const epcList = subject.epcList as Record<string, unknown>[];
      expect(epcList[0].type).toEqual(['Item']);
    });

    it('maps product id to item id', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ id: 'did:web:example.com:product:1' }) }),
      );
      const epcList = subject.epcList as Record<string, unknown>[];
      expect(epcList[0].id).toBe('did:web:example.com:product:1');
    });

    it('maps product name to item name', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ name: 'Widget 3000' }) }));
      const epcList = subject.epcList as Record<string, unknown>[];
      expect(epcList[0].name).toBe('Widget 3000');
    });

    it('maps undefined id and name when product has no id or name', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ id: undefined, name: undefined }) }),
      );
      const epcList = subject.epcList as Record<string, unknown>[];
      expect(epcList[0].id).toBeUndefined();
      expect(epcList[0].name).toBeUndefined();
    });
  });

  // ── silently ignored fields ──────────────────────────────────────────────────

  describe('silently ignored inputs', () => {
    it('does not include organisation in subject', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ organisation: createOrganisation() }));
      expect(subject.organisation).toBeUndefined();
      expect(subject.issuedToParty).toBeUndefined();
    });

    it('does not include facility in subject', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ facility: createFacility() }));
      expect(subject.facility).toBeUndefined();
    });

    it('does not include conformityClaim in subject', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      expect(subject.conformityClaim).toBeUndefined();
    });
  });
});
