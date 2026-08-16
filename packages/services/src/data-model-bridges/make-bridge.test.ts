import { makeBridge } from './make-bridge.js';
import type { BridgeEntities, CredentialSubject, ExtractedRefs, VersionSpec } from './types.js';

describe('makeBridge', () => {
  const mockEntities: BridgeEntities = {
    organisation: { id: 'org-1', name: 'Test Org' },
  };

  const mockSubject: CredentialSubject = {
    type: ['TestCredential'],
    value: 'test',
  };

  const mockRefs: ExtractedRefs = {
    organisations: [{ id: 'org-1' }],
    facilities: [],
    products: [],
  };

  it('delegates buildSubject to spec.builder', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);
    const result = bridge.buildSubject(mockEntities);

    expect(builder).toHaveBeenCalledWith(mockEntities);
    expect(result).toBe(mockSubject);
  });

  it('delegates extractRefs to spec.extractor', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);
    const result = bridge.extractRefs(mockSubject);

    expect(extractor).toHaveBeenCalledWith(mockSubject);
    expect(result).toBe(mockRefs);
  });

  it('does not call extractor when buildSubject is invoked', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);
    bridge.buildSubject(mockEntities);

    expect(extractor).not.toHaveBeenCalled();
  });

  it('does not call builder when extractRefs is invoked', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);
    bridge.extractRefs(mockSubject);

    expect(builder).not.toHaveBeenCalled();
  });

  it('returns an object implementing IDataModelBridge', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);

    expect(typeof bridge.buildSubject).toBe('function');
    expect(typeof bridge.extractRefs).toBe('function');
  });

  describe('conformity claim provenance', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const claim = { scheme: 'https://example.com/s', criteria: [] };

    it("delegates to the version's provenance extractor", () => {
      // Guards the wiring: a mis-keyed spec field, or a version that forgets
      // to register its provenance extractor, would drop every warning
      // pointer in production with nothing else failing.
      const withProvenance = { claim, sourceMap: { '/scheme': '/referenceScheme/id' } };
      const conformityClaimProvenanceExtractor = jest.fn().mockReturnValue(withProvenance);
      const spec: VersionSpec = { builder, extractor, conformityClaimProvenanceExtractor };

      const result = makeBridge(spec).extractConformityClaimWithProvenance(mockSubject);

      expect(conformityClaimProvenanceExtractor).toHaveBeenCalledWith(mockSubject);
      expect(result).toEqual(withProvenance);
    });

    it('still returns the claim, with an empty map, when the version records no provenance', () => {
      // Validation must keep running for such a version; only pointers go.
      const conformityClaimExtractor = jest.fn().mockReturnValue(claim);
      const spec: VersionSpec = { builder, extractor, conformityClaimExtractor };

      const result = makeBridge(spec).extractConformityClaimWithProvenance(mockSubject);

      expect(result).toEqual({ claim, sourceMap: {} });
    });

    it('returns null when the version carries no conformity claim at all', () => {
      const spec: VersionSpec = { builder, extractor };

      expect(makeBridge(spec).extractConformityClaimWithProvenance(mockSubject)).toBeNull();
    });

    it('returns null when the claim extractor finds no claim in the subject', () => {
      const conformityClaimExtractor = jest.fn().mockReturnValue(null);
      const spec: VersionSpec = { builder, extractor, conformityClaimExtractor };

      expect(makeBridge(spec).extractConformityClaimWithProvenance(mockSubject)).toBeNull();
    });

    it('reports the claim from the provenance extractor when no plain one is registered', () => {
      // Both directions fall back, so a version registering only one extractor
      // cannot make the other method claim the credential carries no claim.
      const conformityClaimProvenanceExtractor = jest.fn().mockReturnValue({ claim, sourceMap: {} });
      const spec: VersionSpec = { builder, extractor, conformityClaimProvenanceExtractor };

      expect(makeBridge(spec).extractConformityClaim(mockSubject)).toEqual(claim);
    });
  });
});
