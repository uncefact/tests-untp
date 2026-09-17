// The bundled artefact by path: the utils exports map exposes it only through the bundled-artefacts
// loader, and the test wants the raw published document, not the loader.
import linksetSchema from '../../../untp-utils/artefacts/schema/untp/0.7.0/linkset.json';
import Ajv from 'ajv';
import {
  linkSetSchemaStepDetails,
  linkSetSchemaUrl,
  linkSetValidationSteps,
  toLinkSetSchemaStepDetails,
  validateLinkSetSchema,
} from '@/lib/linkSetValidation';
import { describeArtefactFailure } from '@/lib/artefactFailure';
import { schemaCache } from '@/lib/schemaFetch';
import sample from '../../public/samples/sample-link-set.json';
import { TestCaseStatus, TestCaseStepId } from '../../constants';

const SCHEMA_URL = 'https://untp.unece.org/artefacts/schema/v0.7.0/idr/LinksetSchema.json';

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function withRelation(relation: string, target: Record<string, unknown> = { href: 'https://x.example/a', title: 't' }) {
  return { linkset: [{ anchor: 'https://r.example/01/1', [relation]: [target] }] };
}

describe('linkSetSchemaUrl', () => {
  it('is the published idr schema URL the bundled manifest pins', () => {
    expect(linkSetSchemaUrl('0.7.0')).toBe(SCHEMA_URL);
  });
});

describe('linkSetValidationSteps', () => {
  it('starts with the pending Schema Validation step only', () => {
    expect(linkSetValidationSteps()).toEqual([
      { id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION, name: 'Schema Validation', status: TestCaseStatus.PENDING },
    ]);
  });
});

describe('validateLinkSetSchema against the real bundled v0.7.0 schema', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    schemaCache.clear();
    // A deep copy per test keeps the fetched schema identity isolated between tests.
    fetchMock = jest.fn().mockImplementation(async () => okResponse(JSON.parse(JSON.stringify(linksetSchema))));
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches the published URL for the selected version and accepts the bundled sample', async () => {
    const result = await validateLinkSetSchema(sample, '0.7.0');
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/schema?url=${encodeURIComponent(SCHEMA_URL)}`);
    expect(result).toEqual({ kind: 'document', valid: true, errors: [], version: '0.7.0', schemaUrl: SCHEMA_URL });
  });

  it('reuses the compiled validator for two validations of the same schema URL', async () => {
    const compile = jest.spyOn(Ajv.prototype, 'compile');

    await expect(validateLinkSetSchema(sample, '0.7.0')).resolves.toMatchObject({ kind: 'document', valid: true });
    await expect(validateLinkSetSchema(sample, '0.7.0')).resolves.toMatchObject({ kind: 'document', valid: true });

    expect(compile).toHaveBeenCalledTimes(1);
    compile.mockRestore();
  });

  it('reports a link context with no anchor at its path', async () => {
    const doc = { linkset: [{ dpp: [{ href: 'https://x.example/a', title: 't' }] }] };
    const result = await validateLinkSetSchema(doc, '0.7.0');
    expect(result).toMatchObject({ kind: 'document', valid: false });
    if (result.kind !== 'document') throw new Error('unreachable');
    expect(result.errors).toEqual([
      expect.objectContaining({
        keyword: 'required',
        instancePath: '/linkset/0',
        params: { missingProperty: 'anchor' },
      }),
    ]);
  });

  it('reports a target with no title under a URL relation, with the relation escaped in the pointer', async () => {
    const doc = withRelation('https://test.uncefact.org/voc/untp/dpp', { href: 'https://x.example/a' });
    const result = await validateLinkSetSchema(doc, '0.7.0');
    if (result.kind !== 'document') throw new Error('unreachable');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        keyword: 'required',
        instancePath: '/linkset/0/https:~1~1test.uncefact.org~1voc~1untp~1dpp/0',
        params: { missingProperty: 'title' },
      }),
    ]);
  });

  it('fails a target carrying a property the schema does not allow, even as the only error', async () => {
    // The credential validator treats additionalProperties-only as valid; link sets must not.
    const doc = withRelation('dpp', { href: 'https://x.example/a', title: 't', colour: 'red' });
    const result = await validateLinkSetSchema(doc, '0.7.0');
    if (result.kind !== 'document') throw new Error('unreachable');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        keyword: 'additionalProperties',
        instancePath: '/linkset/0/dpp/0',
        params: { additionalProperty: 'colour' },
      }),
    ]);
  });

  it('uses the shared false-schema root result and Ajv remediation', async () => {
    fetchMock.mockResolvedValue(okResponse(false));
    const result = await validateLinkSetSchema(sample, '0.7.0');
    expect(result).toMatchObject({
      kind: 'document',
      valid: false,
      failure: {
        class: 'credential-invalid',
        code: 'schema.validation.payload',
        remediation: 'boolean schema is false',
      },
    });
    if (result.kind !== 'document') throw new Error('unreachable');
    expect(result.errors).toEqual([
      expect.objectContaining({ keyword: 'false schema', instancePath: '', message: 'boolean schema is false' }),
    ]);
  });

  it('keeps every error when a document breaks several rules', async () => {
    const doc = {
      // `Extra` fails the lowercase relation pattern, so it is an unknown member; a lowercase key
      // would instead be read as a relation whose value must be an array.
      linkset: [{ dpp: [{ href: 'https://x.example/a' }] }, { anchor: 'https://r.example/01/2', Extra: 'no' }],
    };
    const result = await validateLinkSetSchema(doc, '0.7.0');
    if (result.kind !== 'document') throw new Error('unreachable');
    expect(result.errors.map((e) => `${e.keyword}@${e.instancePath}`).sort()).toEqual(
      ['additionalProperties@/linkset/1', 'required@/linkset/0', 'required@/linkset/0/dpp/0'].sort(),
    );
  });

  it.each([
    ['untp:dpp', 'a CURIE'],
    ['https://my-resolver.example.org/voc/dpp', 'a URL relation with a hyphen'],
    ['https://idr.example.org:3000/voc/dpp', 'a URL relation with a port'],
    ['https://example.org/untp#dpp', 'a URL relation with a fragment'],
    ['https://example.org/dpp?x=1', 'a URL relation with a query'],
    ['dpp1', 'a short name containing a digit'],
    ['anchor-extra', 'a short name starting with anchor'],
  ])('rejects %s (%s) as an unknown member of the link context, as the published schema does', async (relation) => {
    const result = await validateLinkSetSchema(withRelation(relation), '0.7.0');
    if (result.kind !== 'document') throw new Error('unreachable');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        keyword: 'additionalProperties',
        instancePath: '/linkset/0',
        params: { additionalProperty: relation },
      }),
    ]);
  });

  it.each(['dpp', 'https://vocabulary.uncefact.org/untp/dpp'])('accepts the relation form %s', async (relation) => {
    await expect(validateLinkSetSchema(withRelation(relation), '0.7.0')).resolves.toMatchObject({ valid: true });
  });

  it('does not mutate the document or the cached schema', async () => {
    const doc = withRelation('dpp');
    const before = JSON.stringify(doc);
    await validateLinkSetSchema(doc, '0.7.0');
    expect(JSON.stringify(doc)).toBe(before);
    await expect(schemaCache.get(SCHEMA_URL, () => Promise.reject(new Error('not cached')))).resolves.toEqual(
      linksetSchema,
    );
  });

  it('keeps two schema documents that share an $id apart', async () => {
    // The published $id is not version-qualified. A second version must compile on its own
    // terms, not be answered by the first version's validator.
    const strict = JSON.parse(JSON.stringify(linksetSchema));
    const relaxed = JSON.parse(JSON.stringify(linksetSchema));
    relaxed.properties.linkset.items.required = [];
    fetchMock.mockImplementation(async (url: string) => okResponse(url.includes('0.7.0') ? strict : relaxed));
    const doc = { linkset: [{ dpp: [{ href: 'https://x.example/a', title: 't' }] }] };
    await expect(validateLinkSetSchema(doc, '0.7.0')).resolves.toMatchObject({ valid: false });
    await expect(validateLinkSetSchema(doc, '0.8.0')).resolves.toMatchObject({ valid: true, version: '0.8.0' });
  });

  it('reports an unavailable schema as a failure to assess, with the transport reason and the URL', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'Schema host unreachable' }),
    });
    await expect(validateLinkSetSchema(sample, '0.7.0')).resolves.toMatchObject({
      kind: 'schema-unavailable',
      reason: 'network',
      message: expect.stringContaining('Schema host unreachable'),
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
      failure: {
        class: 'could-not-fetch',
        artefactUrl: SCHEMA_URL,
      },
    });
  });

  it('keeps a link-set schema 4xx as could-not-fetch with version-selection remediation', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'Schema host returned status 404', code: 'upstream-status', upstreamStatus: 404 }),
    });

    const result = await validateLinkSetSchema(sample, '0.7.0');
    expect(result).toMatchObject({
      kind: 'schema-unavailable',
      reason: 'not-found',
      schemaUrl: SCHEMA_URL,
      failure: {
        class: 'could-not-fetch',
        code: 'schema.fetch.upstream-status',
        artefactUrl: SCHEMA_URL,
        upstreamStatus: 404,
        remediation: 'Pick a UNTP version that has a published link-set schema.',
      },
    });
    expect(describeArtefactFailure(result.failure, 'link-set')).toMatchObject({ heading: 'Could not fetch' });
    expect(describeArtefactFailure(result.failure, 'link-set')?.heading).not.toBe('Link set invalid');
    expect(result.failure?.remediation).not.toContain('@context');
    expect(result.failure?.message).not.toContain('@context');
  });

  it('preserves an invalid-json route failure as an unusable artefact with its reason and message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'The schema host returned invalid JSON', code: 'invalid-json' }),
    });
    await expect(validateLinkSetSchema(sample, '0.7.0')).resolves.toMatchObject({
      kind: 'schema-unavailable',
      reason: 'parse',
      message:
        'The schema host returned invalid JSON (https://untp.unece.org/artefacts/schema/v0.7.0/idr/LinksetSchema.json).',
      failure: {
        class: 'unusable-artefact',
        code: 'schema.fetch.invalid-json',
      },
    });
  });

  it('reports a schema that loads but cannot be compiled as unusable, not as a document violation', async () => {
    fetchMock.mockResolvedValue(okResponse({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'nonsense' }));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(validateLinkSetSchema(sample, '0.7.0')).resolves.toMatchObject({
        kind: 'schema-unusable',
        version: '0.7.0',
        schemaUrl: SCHEMA_URL,
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('step details round trip', () => {
  it('drops only the valid flag on the way in and narrows it back on the way out', () => {
    const result = {
      kind: 'document' as const,
      valid: false,
      errors: [{ keyword: 'required', instancePath: '', params: {}, schemaPath: '#', message: 'x' }],
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
    };
    const details = toLinkSetSchemaStepDetails(result);
    expect(details).toEqual({ kind: 'document', errors: result.errors, version: '0.7.0', schemaUrl: SCHEMA_URL });
    const step = {
      id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
      name: 'Schema Validation',
      status: TestCaseStatus.FAILURE,
      details,
    };
    expect(linkSetSchemaStepDetails(step)).toBe(details);
    expect(linkSetSchemaStepDetails({ ...step, details: { errors: [] } })).toBeUndefined();
    expect(linkSetSchemaStepDetails({ ...step, details: undefined })).toBeUndefined();
  });
});

describe('linkSetSchemaStepDetails field checks (#814)', () => {
  const step = (details: unknown) =>
    ({ id: 'linkset-schema-validation', name: 'Schema Validation', status: 'failure', details }) as any;
  it('rejects a kind with no attempt fields, and each variant missing a required field', () => {
    expect(linkSetSchemaStepDetails(step({ kind: 'document' }))).toBeUndefined();
    expect(linkSetSchemaStepDetails(step({ kind: 'document', version: '0.7.0', schemaUrl: 'u' }))).toBeUndefined();
    expect(
      linkSetSchemaStepDetails(step({ kind: 'schema-unavailable', version: '0.7.0', schemaUrl: 'u', message: 'm' })),
    ).toBeUndefined();
    expect(
      linkSetSchemaStepDetails(step({ kind: 'schema-unusable', version: '0.7.0', schemaUrl: 'u' })),
    ).toBeUndefined();
    expect(linkSetSchemaStepDetails(step({ kind: 'document', version: '0.7.0', schemaUrl: 'u', errors: [] }))).toEqual({
      kind: 'document',
      version: '0.7.0',
      schemaUrl: 'u',
      errors: [],
    });
    expect(
      linkSetSchemaStepDetails(
        step({ kind: 'schema-unavailable', version: '0.7.0', schemaUrl: 'u', message: 'm', reason: 'timeout' }),
      ),
    ).toMatchObject({ reason: 'timeout' });
    expect(
      linkSetSchemaStepDetails(step({ kind: 'schema-unusable', version: '0.7.0', schemaUrl: 'u', message: 'm' })),
    ).toMatchObject({ message: 'm' });
  });
});
