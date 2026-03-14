import { buildContextAndTypes } from './context.js';
import type { DataModelConfig } from '../types.js';

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
