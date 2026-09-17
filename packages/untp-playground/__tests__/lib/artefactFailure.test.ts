import {
  classifyJsonLdFailure,
  classifySchemaFetchFailure,
  classifySchemaSelectionFailure,
  describeArtefactFailure,
  isUnexpectedFailure,
} from '@/lib/artefactFailure';
import type { ArtefactStepFailure } from '@/lib/artefactFailure';
import { validateSchemaDocument } from '@/lib/schemaValidation';
import { buildUntpArtefactUrls } from '@uncefact/untp-utils/artefacts';

const schemaUrl = 'https://publisher.example/schema.json';

const offUnionFailure: ArtefactStepFailure = {
  // @ts-expect-error: Artefact failure classes are intentionally closed.
  class: 'legacy-failure',
  code: 'context.document.unknown',
  message: 'old diagnostic',
  remediation: 'Change the credential.',
};
void offUnionFailure;

describe('artefact failure classes', () => {
  it('maps a 503 upstream response to could-not-fetch with both statuses and the URL', () => {
    const failure = classifySchemaFetchFailure({
      schemaUrl,
      category: 'upstream-status',
      serviceStatus: 502,
      upstreamStatus: 503,
      reason: 'network',
      message: 'upstream failed',
    });

    expect(failure).toMatchObject({
      class: 'could-not-fetch',
      artefactUrl: schemaUrl,
      serviceStatus: 502,
      upstreamStatus: 503,
    });
    expect(failure.remediation).toMatch(/Retry/);
    expect(failure.remediation).not.toMatch(/credential/i);
  });

  it.each([403, 404, 410])('maps a schema HTTP %s to credential-invalid when no bundled copy exists', (status) => {
    const failure = classifySchemaFetchFailure(
      {
        schemaUrl,
        category: 'upstream-status',
        serviceStatus: 502,
        upstreamStatus: status,
        reason: 'not-found',
        message: `upstream returned ${status}`,
      },
      'credential',
      '0.7.0',
    );
    expect(failure).toMatchObject({
      class: 'credential-invalid',
      code: 'schema.fetch.not-published',
      artefactUrl: schemaUrl,
      upstreamStatus: status,
      declaredVersion: '0.7.0',
    });
    expect(failure.message).toContain(schemaUrl);
    expect(failure.message).toContain(`HTTP status ${status}`);
    expect(failure.message).toContain('declared version 0.7.0');
    expect(failure.remediation).toContain('@context version 0.7.0');
  });

  it.each([408, 429])('keeps a schema HTTP %s as could-not-fetch for retry or reporting', (status) => {
    const failure = classifySchemaFetchFailure(
      {
        schemaUrl,
        category: 'upstream-status',
        serviceStatus: 502,
        upstreamStatus: status,
        reason: 'network',
        message: `upstream returned ${status}`,
      },
      'credential',
      '0.7.0',
    );

    expect(failure).toMatchObject({
      class: 'could-not-fetch',
      code: 'schema.fetch.upstream-status',
      artefactUrl: schemaUrl,
      upstreamStatus: status,
    });
    expect(failure).not.toHaveProperty('declaredVersion');
    expect(failure.remediation).toMatch(/Retry|report/i);
  });

  it('keeps a 5xx schema response and a timeout as could-not-fetch', () => {
    expect(
      classifySchemaFetchFailure(
        {
          schemaUrl,
          category: 'upstream-status',
          upstreamStatus: 503,
          reason: 'network',
          message: 'busy',
        },
        'credential',
        '0.7.0',
      ).class,
    ).toBe('could-not-fetch');
    expect(
      classifySchemaFetchFailure(
        {
          schemaUrl,
          category: 'uncoded',
          reason: 'timeout',
          message: 'timed out',
          browserSide: true,
        },
        'credential',
        '0.7.0',
      ).class,
    ).toBe('could-not-fetch');
  });

  it('maps invalid JSON to unusable-artefact, while an uncoded 400 is unknown', () => {
    expect(
      classifySchemaFetchFailure({
        schemaUrl,
        category: 'invalid-json',
        serviceStatus: 502,
        reason: 'parse',
        message: 'invalid JSON',
      }),
    ).toMatchObject({ class: 'unusable-artefact', artefactUrl: schemaUrl });

    const rejected = classifySchemaFetchFailure({
      schemaUrl,
      category: 'uncoded',
      serviceStatus: 400,
      reason: 'network',
      message: 'rejected',
    });
    expect(rejected.class).toBe('unknown');
    expect(rejected.remediation).not.toMatch(/Retry/);

    expect(
      classifySchemaFetchFailure({
        schemaUrl,
        category: 'uncoded',
        serviceStatus: 500,
        reason: 'network',
        message: 'service failed',
      }).class,
    ).toBe('could-not-fetch');
  });

  it.each([
    ['timeout', 'schema.fetch.timeout'],
    ['network', 'schema.fetch.network'],
    ['unreadable-response', 'schema.fetch.unreadable-response'],
  ] as const)('classifies a browser-side %s reason before route category', (reason, code) => {
    expect(
      classifySchemaFetchFailure({
        schemaUrl,
        category: 'uncoded',
        serviceStatus: 200,
        reason,
        message: 'browser transport failed',
        browserSide: true,
      }),
    ).toMatchObject({ class: 'could-not-fetch', code, serviceStatus: 200 });
  });

  it('keeps an unrecognised route category unknown for an uncoded sub-500 response', () => {
    const failure = classifySchemaFetchFailure({
      schemaUrl,
      category: 'new-route-category',
      serviceStatus: 400,
      reason: 'network',
      message: 'route rejected',
    });
    expect(failure).toMatchObject({ class: 'unknown', code: 'schema.fetch.uncoded' });
    expect(failure.message).toContain('new-route-category');
  });

  it('keeps selection faults credential-invalid except for builder failures', () => {
    const version = classifySchemaSelectionFailure(
      { reason: 'version-not-detected', message: 'Observed contexts did not contain a recognised version.' },
      'credential',
    );
    expect(version).toMatchObject({ class: 'credential-invalid', code: 'schema.selection.version-not-detected' });
    expect(version.remediation).toContain('@context');
    const type = classifySchemaSelectionFailure(
      { reason: 'unknown-type', message: 'Observed types were unknown.' },
      'credential',
    );
    expect(type).toMatchObject({ class: 'credential-invalid', code: 'schema.selection.unknown-type' });
    expect(type.remediation).toContain('type');
    const extension = classifySchemaSelectionFailure(
      { reason: 'unsupported-extension-version', message: 'Observed extension context was unknown.' },
      'extension',
    );
    expect(extension.remediation).toContain('extension context entry');
    const vcdm = classifySchemaSelectionFailure(
      { reason: 'vcdm-version-unmapped', message: 'Observed VCDM context was unknown.' },
      'vcdm',
    );
    expect(vcdm.remediation).toContain('@context');
    const scheme = classifySchemaSelectionFailure(
      { reason: 'scheme-version-unsupported', message: 'The scheme is too old.' },
      'scheme',
    );
    expect(scheme.remediation).toContain('scheme version in @context');
    expect(
      classifySchemaSelectionFailure({ reason: 'builder', message: 'URL builder failed.' }, 'credential'),
    ).toMatchObject({ class: 'unknown', code: 'schema.selection.builder' });
  });

  it('maps JSON-LD provenance without inferring ownership from a code or absent URL', () => {
    expect(
      classifyJsonLdFailure({
        kind: 'document',
        source: 'safe-mode-event',
        code: 'invalid property',
        detail: 'unknown property',
        fields: { property: 'madeUpTerm' },
      }),
    ).toMatchObject({ class: 'credential-invalid', code: 'context.document.invalid-property' });

    const language = classifyJsonLdFailure({
      kind: 'document',
      source: 'safe-mode-event',
      code: 'invalid @language value',
      detail: 'bad language',
    });
    expect(language.class).toBe('unknown');
    expect(language.message).toContain('the credential or a remote context caused it');

    const invalidWithoutUrl = classifyJsonLdFailure({
      kind: 'context-invalid',
      detail: 'invalid scoped context',
      code: 'invalid scoped context',
    });
    expect(invalidWithoutUrl.class).toBe('unknown');
    expect(invalidWithoutUrl.message).not.toMatch(/fetched|remote/i);

    expect(
      classifyJsonLdFailure({
        kind: 'context-invalid',
        url: 'https://publisher.example/context.jsonld',
        code: 'resolver.invalid-json',
        detail: 'not JSON',
      }),
    ).toMatchObject({ class: 'unusable-artefact', artefactUrl: 'https://publisher.example/context.jsonld' });

    expect(
      classifyJsonLdFailure({
        kind: 'context-fetch',
        url: 'https://publisher.example/context.jsonld',
        code: 'resolver.network',
        detail: 'host unavailable',
      }),
    ).toMatchObject({ class: 'could-not-fetch', artefactUrl: 'https://publisher.example/context.jsonld' });
  });

  it.each([403, 404, 410])('maps a UNTP context HTTP %s to credential-invalid with the declared version', (status) => {
    const contextUrl = buildUntpArtefactUrls('DigitalProductPassport', '0.7.0').contextUrl;
    const failure = classifyJsonLdFailure(
      {
        kind: 'context-fetch',
        url: contextUrl,
        code: 'resolver.http-error',
        upstreamStatus: status,
        detail: `could not fetch a remote @context: HTTP ${status}`,
      },
      'context',
      '0.7.0',
      new Set([contextUrl]),
    );
    expect(failure).toMatchObject({
      class: 'credential-invalid',
      code: 'context.fetch.not-published',
      artefactUrl: contextUrl,
      upstreamStatus: status,
      declaredVersion: '0.7.0',
    });
    expect(failure.message).toContain(contextUrl);
    expect(failure.message).toContain(`HTTP status ${status}`);
    expect(failure.remediation).toContain('@context version 0.7.0');
  });

  it('uses the scheme noun for an unpublished third-party context', () => {
    const contextUrl = 'https://publisher.example/scheme-context.jsonld';
    const failure = classifyJsonLdFailure(
      {
        kind: 'context-fetch',
        url: contextUrl,
        code: 'resolver.http-error',
        upstreamStatus: 404,
        detail: 'could not fetch a remote @context: HTTP 404',
      },
      'scheme',
      undefined,
      new Set([contextUrl]),
    );

    expect(failure).toMatchObject({
      class: 'credential-invalid',
      code: 'context.fetch.not-published',
      artefactUrl: contextUrl,
      upstreamStatus: 404,
      message: `No context is published at ${contextUrl} (status 404). Check the scheme's @context entry.`,
      remediation: `Check the scheme's @context entry for ${contextUrl}.`,
    });
  });

  it('uses the scheme noun for document context diagnostics', () => {
    const invalidProperty = classifyJsonLdFailure(
      {
        kind: 'document',
        source: 'safe-mode-event',
        code: 'invalid property',
        detail: 'unknown property',
        fields: { property: 'schemeTerm' },
      },
      'scheme',
    );
    expect(invalidProperty).toMatchObject({
      message: 'The scheme uses property "schemeTerm", but no supplied JSON-LD context defines it.',
      remediation: 'Add "schemeTerm" to a context, or remove it from the scheme.',
    });
  });

  it.each([408, 429])('keeps a UNTP context HTTP %s as could-not-fetch for retry or reporting', (status) => {
    const contextUrl = buildUntpArtefactUrls('DigitalProductPassport', '0.7.0').contextUrl;
    const failure = classifyJsonLdFailure(
      {
        kind: 'context-fetch',
        url: contextUrl,
        code: 'resolver.http-error',
        upstreamStatus: status,
        detail: `could not fetch a remote @context: HTTP ${status}`,
      },
      'context',
      '0.7.0',
      new Set([contextUrl]),
    );

    expect(failure).toMatchObject({
      class: 'could-not-fetch',
      code: 'context.fetch',
      artefactUrl: contextUrl,
      upstreamStatus: status,
    });
    expect(failure).not.toHaveProperty('declaredVersion');
    expect(failure.remediation).toMatch(/Retry|report/i);
  });

  it('classifies an undeclared context dependency as could-not-fetch', () => {
    const declaredUrl = buildUntpArtefactUrls('DigitalProductPassport', '0.7.0').contextUrl;
    const contextUrl = 'https://publisher.example/context.jsonld';
    const failure = classifyJsonLdFailure(
      {
        kind: 'context-fetch',
        url: contextUrl,
        code: 'resolver.http-error',
        upstreamStatus: 404,
        detail: 'could not fetch a remote @context: HTTP 404',
      },
      'context',
      '0.7.0',
      new Set([declaredUrl]),
      { declaredContextEntry: declaredUrl },
    );

    expect(failure).toMatchObject({
      class: 'could-not-fetch',
      code: 'context.fetch',
      artefactUrl: contextUrl,
      upstreamStatus: 404,
      message: `The context dependency at "${contextUrl}" returned HTTP status 404; it was reached through declared context "${declaredUrl}".`,
      remediation: `The context at ${declaredUrl} depends on ${contextUrl}, which its publisher has not published. Report it to that publisher.`,
    });
    expect(failure).not.toHaveProperty('declaredVersion');
  });

  it('uses publisher remediation when the context declaration walk is incomplete', () => {
    const declaredUrl = 'https://publisher.example/context-a.jsonld';
    const dependencyUrl = 'https://publisher.example/context-b.jsonld';
    const failure = classifyJsonLdFailure(
      {
        kind: 'context-fetch',
        url: dependencyUrl,
        code: 'resolver.http-error',
        upstreamStatus: 410,
        detail: 'could not fetch a remote @context: HTTP 410',
      },
      'context',
      undefined,
      new Set([declaredUrl]),
      { contextDeclarationsComplete: false },
    );

    expect(failure).toMatchObject({
      class: 'could-not-fetch',
      code: 'context.fetch',
      artefactUrl: dependencyUrl,
      upstreamStatus: 410,
      remediation: `The context at ${dependencyUrl} has not been published by its publisher. Report it to the publisher of the context that imported it.`,
    });
    expect(failure.remediation).not.toContain(declaredUrl);
  });

  it('keeps a context 5xx and its upstream status as could-not-fetch', () => {
    const failure = classifyJsonLdFailure(
      {
        kind: 'context-fetch',
        url: 'https://publisher.example/context.jsonld',
        code: 'resolver.http-error',
        upstreamStatus: 503,
        detail: 'busy',
      },
      'context',
      '0.7.0',
    );
    expect(failure).toMatchObject({ class: 'could-not-fetch', code: 'context.fetch', upstreamStatus: 503 });
    expect(failure).toHaveProperty('artefactUrl', 'https://publisher.example/context.jsonld');
  });

  it('keeps the verifier-facing context timeout copy independent of the server budget', () => {
    const failure = classifyJsonLdFailure(
      {
        kind: 'context-fetch',
        url: 'https://publisher.example/context.jsonld',
        code: 'resolver.timed-out',
        detail: 'timed out after 10000ms',
      },
      'context',
    );
    expect(failure).toMatchObject({ class: 'could-not-fetch', code: 'context.fetch' });
    expect(failure.message).toContain('timed out while fetching the remote @context');
    expect(failure.message).not.toContain('10000');
    expect(
      classifyJsonLdFailure(
        { kind: 'service', detail: "The Playground's context service did not respond within 15s. Retry in a moment." },
        'context',
        '0.7.0',
      ).class,
    ).toBe('could-not-fetch');
  });

  it('uses the exact pipeline code set for unexpected toasts', () => {
    expect(
      isUnexpectedFailure({ code: 'playground.pipeline.unexpected', class: 'unknown', message: '', remediation: '' }),
    ).toBe(true);
    expect(
      isUnexpectedFailure({
        code: 'playground.pipeline.initialisation',
        class: 'unknown',
        message: '',
        remediation: '',
      }),
    ).toBe(true);
    expect(
      isUnexpectedFailure({ code: 'playground.pipeline.step', class: 'unknown', message: '', remediation: '' }),
    ).toBe(true);
    expect(
      isUnexpectedFailure({
        code: 'playground.pipeline.not-executed',
        class: 'unknown',
        message: '',
        remediation: '',
        blockedBy: 'proof-type',
      } as never),
    ).toBe(false);
    expect(isUnexpectedFailure(undefined)).toBe(false);
  });

  it('uses the credential default remediation when invalid property has no term', () => {
    const failure = classifyJsonLdFailure({
      kind: 'document',
      source: 'safe-mode-event',
      code: 'invalid property',
      detail: 'unknown property',
    });
    expect(failure.remediation).toBe('Correct the named field or term in the credential.');
    expect(failure.remediation).not.toContain('undefined');
  });

  it('type-gates schema roots before Ajv and preserves the false-schema diagnostic', () => {
    expect(validateSchemaDocument(true, {}, schemaUrl, 'credential')).toEqual({ valid: true, errors: [] });

    const falseSchema = validateSchemaDocument(false, {}, schemaUrl, 'credential');
    expect(falseSchema).toMatchObject({ valid: false, failure: { class: 'credential-invalid' } });
    expect(falseSchema.errors).toEqual([
      expect.objectContaining({ keyword: 'false schema', instancePath: '', message: 'boolean schema is false' }),
    ]);
    expect(falseSchema.failure?.remediation).toBe('boolean schema is false');

    for (const invalidRoot of [null, 'schema', 1, []]) {
      const result = validateSchemaDocument(invalidRoot, {}, schemaUrl, 'credential');
      expect(result).toMatchObject({ valid: false, failure: { class: 'unusable-artefact', artefactUrl: schemaUrl } });
    }
  });

  it('reports carried-dialect meta-schema failures with the URL and Ajv diagnostics', () => {
    const result = validateSchemaDocument(
      { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 17 },
      {},
      schemaUrl,
      'credential',
    );
    expect(result).toMatchObject({
      valid: false,
      failure: {
        class: 'unusable-artefact',
        code: 'schema.validation.meta-schema',
        artefactUrl: schemaUrl,
      },
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ keyword: 'type' })]));
  });

  it('treats a not schema root like a false schema root', () => {
    const falseSchema = validateSchemaDocument(false, {}, schemaUrl, 'credential');
    const notSchema = validateSchemaDocument({ not: {} }, {}, schemaUrl, 'credential');
    expect(notSchema).toMatchObject({
      valid: false,
      failure: {
        class: 'credential-invalid',
        code: 'schema.validation.payload',
        artefactUrl: schemaUrl,
      },
    });
    expect(notSchema.errors?.[0]).toMatchObject({
      instancePath: '',
      keyword: 'not',
      message: expect.any(String),
    });
    expect(notSchema.failure?.remediation).toBe(notSchema.errors?.[0]?.message);
    expect(notSchema.errors?.[0]?.instancePath).toBe(falseSchema.errors?.[0]?.instancePath);
  });

  it('does not classify a schema with an uncarried dialect as an unusable artefact', () => {
    const result = validateSchemaDocument(
      { $schema: 'https://json-schema.org/draft/2019-09/schema', type: 'object' },
      {},
      schemaUrl,
      'credential',
    );

    expect(result).toMatchObject({
      valid: false,
      failure: { class: 'unknown', code: 'schema.validation.dialect', artefactUrl: schemaUrl },
    });
  });

  it('uses the family heading and does not provide credential advice for unknown failures', () => {
    const presentation = describeArtefactFailure(
      {
        class: 'unknown',
        code: 'context.document.unknown',
        message: 'Diagnostic code: invalid @language value.',
        remediation: 'Report these details to the Playground operator.',
      },
      'context',
    );
    expect(presentation).toEqual({
      heading: 'Could not determine the cause',
      message: 'Diagnostic code: invalid @language value.',
      remediation: 'Report these details to the Playground operator.',
    });
  });
});
