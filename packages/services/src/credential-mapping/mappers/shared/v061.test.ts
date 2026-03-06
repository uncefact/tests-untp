import { buildIdentifierScheme, buildParty, buildContextAndTypes } from './v061';
import type { OrganisationEntity, DataModelConfig } from '../../types';

describe('buildIdentifierScheme', () => {
  it('returns IdentifierScheme object when scheme has both id and name', () => {
    const result = buildIdentifierScheme({ id: 'scheme-1', name: 'GLN' });

    expect(result).toEqual({
      type: ['IdentifierScheme'],
      id: 'scheme-1',
      name: 'GLN',
    });
  });

  it('returns undefined when scheme is null', () => {
    const result = buildIdentifierScheme(null);

    expect(result).toBeUndefined();
  });

  it('returns undefined when scheme is undefined', () => {
    const result = buildIdentifierScheme(undefined);

    expect(result).toBeUndefined();
  });

  it('returns undefined when scheme has id but no name', () => {
    const result = buildIdentifierScheme({ id: 'scheme-1' });

    expect(result).toBeUndefined();
  });

  it('returns undefined when scheme has name but no id', () => {
    const result = buildIdentifierScheme({ name: 'GLN' });

    expect(result).toBeUndefined();
  });
});

describe('buildParty', () => {
  it('returns party with all fields when org has description and primaryIdentifier', () => {
    const org: OrganisationEntity = {
      id: 'org-1',
      name: 'Test Organisation',
      description: 'A test org',
      primaryIdentifier: {
        value: '1234567890',
        scheme: { id: 'scheme-1', name: 'GLN' },
      },
    };

    const result = buildParty(org);

    expect(result).toEqual({
      id: 'org-1',
      name: 'Test Organisation',
      description: 'A test org',
      registeredId: '1234567890',
      idScheme: {
        type: ['IdentifierScheme'],
        id: 'scheme-1',
        name: 'GLN',
      },
    });
  });

  it('returns party with id and name only when org has no description or primaryIdentifier', () => {
    const org: OrganisationEntity = {
      id: 'org-2',
      name: 'Minimal Org',
    };

    const result = buildParty(org);

    expect(result).toEqual({
      id: 'org-2',
      name: 'Minimal Org',
    });
  });

  it('returns party with undefined id/name when org is undefined', () => {
    const result = buildParty(undefined);

    expect(result).toEqual({
      id: undefined,
      name: undefined,
    });
  });

  it('omits description when org.description is falsy', () => {
    const org: OrganisationEntity = {
      id: 'org-3',
      name: 'No Description',
      description: '',
    };

    const result = buildParty(org);

    expect(result.description).toBeUndefined();
  });

  it('omits registeredId/idScheme when org.primaryIdentifier is null', () => {
    const org: OrganisationEntity = {
      id: 'org-4',
      name: 'No Identifier',
      primaryIdentifier: null,
    };

    const result = buildParty(org);

    expect(result.registeredId).toBeUndefined();
    expect(result.idScheme).toBeUndefined();
  });
});

describe('buildContextAndTypes', () => {
  const coreConfig: DataModelConfig = {
    core: {
      contextUrl: 'https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/',
      credentialType: 'DigitalConformityCredential',
    },
  };

  it('returns single context and type when no extension', () => {
    const result = buildContextAndTypes(coreConfig);

    expect(result).toEqual({
      contexts: ['https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/'],
      types: ['DigitalConformityCredential'],
    });
  });

  it('appends extension context URL when extension is present', () => {
    const config: DataModelConfig = {
      ...coreConfig,
      extension: {
        contextUrl: 'https://example.org/ext/v1/',
        credentialType: 'DigitalConformityCredential',
      },
    };

    const result = buildContextAndTypes(config);

    expect(result.contexts).toEqual([
      'https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/',
      'https://example.org/ext/v1/',
    ]);
  });

  it('deduplicates type when extension.credentialType matches core.credentialType', () => {
    const config: DataModelConfig = {
      ...coreConfig,
      extension: {
        contextUrl: 'https://example.org/ext/v1/',
        credentialType: 'DigitalConformityCredential',
      },
    };

    const result = buildContextAndTypes(config);

    expect(result.types).toEqual(['DigitalConformityCredential']);
  });

  it('includes both types when extension.credentialType differs from core.credentialType', () => {
    const config: DataModelConfig = {
      ...coreConfig,
      extension: {
        contextUrl: 'https://example.org/product-ext/v1/',
        credentialType: 'DigitalProductPassport',
      },
    };

    const result = buildContextAndTypes(config);

    expect(result.types).toEqual(['DigitalConformityCredential', 'DigitalProductPassport']);
  });
});
