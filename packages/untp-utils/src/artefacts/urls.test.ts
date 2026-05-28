import {
  buildUntpArtefactUrls,
  buildSpecificationPageUrl,
  UNTP_SHORT_CREDENTIAL_TYPES,
  UNTP_CORE_SCHEMA_FILENAMES,
  UNTP_SPECIFICATION_PAGE_SLUGS,
} from './urls';

describe('buildUntpArtefactUrls', () => {
  describe('v0.6.x (legacy layout)', () => {
    it('builds the legacy per-credential-type schema and context URLs', () => {
      expect(buildUntpArtefactUrls('DigitalProductPassport', '0.6.1')).toEqual({
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.1.json',
        contextUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/context/',
      });
    });

    it('uses the legacy layout for v0.6.0', () => {
      expect(buildUntpArtefactUrls('DigitalConformityCredential', '0.6.0')).toEqual({
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dcc/untp-dcc-schema-0.6.0.json',
        contextUrl: 'https://test.uncefact.org/vocabulary/untp/dcc/0.6.0/context/',
      });
    });
  });

  describe('v0.7.0+ (artefacts layout)', () => {
    it('builds the artefacts schema URL and unified context URL for DPP', () => {
      expect(buildUntpArtefactUrls('DigitalProductPassport', '0.7.0')).toEqual({
        schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json',
        contextUrl: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
      });
    });

    it('maps DigitalConformityCredential to the ConformityCredential schema file name', () => {
      expect(buildUntpArtefactUrls('DigitalConformityCredential', '0.7.0').schemaUrl).toBe(
        'https://untp.unece.org/artefacts/schema/v0.7.0/dcc/ConformityCredential.json',
      );
    });

    it.each([
      ['DigitalFacilityRecord', 'dfr', 'DigitalFacilityRecord'],
      ['DigitalIdentityAnchor', 'dia', 'DigitalIdentityAnchor'],
      ['DigitalTraceabilityEvent', 'dte', 'DigitalTraceabilityEvent'],
    ])('builds the artefacts schema URL for %s', (type, shortCode, fileName) => {
      expect(buildUntpArtefactUrls(type, '0.7.0').schemaUrl).toBe(
        `https://untp.unece.org/artefacts/schema/v0.7.0/${shortCode}/${fileName}.json`,
      );
    });

    it('builds the artefacts schema and unified context URLs for ConformityScheme (introduced in v0.7.0)', () => {
      expect(buildUntpArtefactUrls('ConformityScheme', '0.7.0')).toEqual({
        schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.0/cvc/ConformityScheme.json',
        contextUrl: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
      });
    });

    it('shares one unified context URL across credentials and the conformity scheme', () => {
      const dpp = buildUntpArtefactUrls('DigitalProductPassport', '0.7.0').contextUrl;
      const dte = buildUntpArtefactUrls('DigitalTraceabilityEvent', '0.7.0').contextUrl;
      const cvc = buildUntpArtefactUrls('ConformityScheme', '0.7.0').contextUrl;
      expect(new Set([dpp, dte, cvc]).size).toBe(1);
      expect(dpp).toBe('https://vocabulary.uncefact.org/untp/0.7.0/context/');
    });

    it('treats a future minor (0.8.0) as the artefacts layout', () => {
      expect(buildUntpArtefactUrls('DigitalProductPassport', '0.8.0').schemaUrl).toBe(
        'https://untp.unece.org/artefacts/schema/v0.8.0/dpp/DigitalProductPassport.json',
      );
    });

    it('treats a future major (1.0.0) as the artefacts layout', () => {
      expect(buildUntpArtefactUrls('DigitalProductPassport', '1.0.0').contextUrl).toBe(
        'https://vocabulary.uncefact.org/untp/1.0.0/context/',
      );
    });
  });

  describe('unknown artefact type', () => {
    it('throws with a helpful message listing the supported types', () => {
      expect(() => buildUntpArtefactUrls('DigitalLivestockPassport', '0.7.0')).toThrow(/Unknown UNTP artefact type/);
    });
  });

  describe('exported maps', () => {
    it('the short-code and schema-filename maps agree on the set of supported types', () => {
      expect(Object.keys(UNTP_SHORT_CREDENTIAL_TYPES).sort()).toEqual(Object.keys(UNTP_CORE_SCHEMA_FILENAMES).sort());
    });
  });
});

describe('buildSpecificationPageUrl', () => {
  it('links the current docs version (0.7.0) at the unversioned path', () => {
    expect(buildSpecificationPageUrl('DigitalProductPassport', '0.7.0')).toBe(
      'https://untp.unece.org/docs/specification/DigitalProductPassport',
    );
  });

  it('links an older version (0.6.0) at the versioned path', () => {
    expect(buildSpecificationPageUrl('DigitalProductPassport', '0.6.0')).toBe(
      'https://untp.unece.org/docs/0.6.0/specification/DigitalProductPassport',
    );
  });

  it('falls back to the 0.6.0 docs for 0.6.1 (which has no docs of its own)', () => {
    expect(buildSpecificationPageUrl('DigitalProductPassport', '0.6.1')).toBe(
      'https://untp.unece.org/docs/0.6.0/specification/DigitalProductPassport',
    );
  });

  it('uses the ConformityCredential slug for DigitalConformityCredential', () => {
    expect(buildSpecificationPageUrl('DigitalConformityCredential', '0.7.0')).toBe(
      'https://untp.unece.org/docs/specification/ConformityCredential',
    );
  });

  it('uses the plural DigitalTraceabilityEvents slug for DigitalTraceabilityEvent', () => {
    expect(buildSpecificationPageUrl('DigitalTraceabilityEvent', '0.6.0')).toBe(
      'https://untp.unece.org/docs/0.6.0/specification/DigitalTraceabilityEvents',
    );
  });

  it('uses the ConformityVocabularyCatalog slug for ConformityScheme', () => {
    expect(buildSpecificationPageUrl('ConformityScheme', '0.7.0')).toBe(
      'https://untp.unece.org/docs/specification/ConformityVocabularyCatalog',
    );
  });

  it('throws for an unknown artefact type', () => {
    expect(() => buildSpecificationPageUrl('DigitalLivestockPassport', '0.7.0')).toThrow(/Unknown UNTP artefact type/);
  });

  it('keeps the slug set aligned with the short-code map', () => {
    expect(Object.keys(UNTP_SPECIFICATION_PAGE_SLUGS).sort()).toEqual(Object.keys(UNTP_SHORT_CREDENTIAL_TYPES).sort());
  });
});
