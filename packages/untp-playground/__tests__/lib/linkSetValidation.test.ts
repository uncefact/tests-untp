// The bundled artefact by path: the utils exports map exposes it only through the bundled-artefacts
// loader, and the test wants the raw published document, not the loader.
import linksetSchema from '../../../untp-utils/artefacts/schema/untp/0.7.0/linkset.json';
import {
  linkSetSchemaStepDetails,
  linkSetSchemaUrl,
  linkSetValidationSteps,
  toLinkSetSchemaStepDetails,
  validateLinkSetSchema,
} from '@/lib/linkSetValidation';
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
    // A deep copy per test: the transport caches the parsed body and the validator keys its
    // compiled form on that object, so tests must not share one mutable instance.
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
    await expect(validateLinkSetSchema(sample, '0.7.0')).resolves.toEqual({
      kind: 'schema-unavailable',
      reason: 'network',
      message: expect.stringContaining('Schema host unreachable'),
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
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
