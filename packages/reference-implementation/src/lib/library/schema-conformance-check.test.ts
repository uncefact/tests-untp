const decodeCredential = jest.fn();
const validateAgainstSchemas = jest.fn();
const validateJsonLd = jest.fn();
const describeJsonLdFailure = jest.fn();
const createJsonLdDocumentLoader = jest.fn();
const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

jest.mock('@uncefact/untp-ri-services', () => ({ decodeCredential }));
jest.mock('@/lib/api/logger', () => ({ apiLogger: logger }));
jest.mock('@uncefact/untp-utils/validation', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/validation');
  return { ...actual, validateAgainstSchemas, validateJsonLd, describeJsonLdFailure };
});
jest.mock('@uncefact/untp-utils/loaders', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/loaders');
  return { ...actual, createJsonLdDocumentLoader };
});

import {
  JsonLdExpansionFailedError,
  SchemaCompilationFailedError,
  SchemaFetchFailedError,
  SchemaPayloadError,
} from '@uncefact/untp-utils/validation';
import { CheckResult, CoreCredentialType, CredentialDetailsStatus } from '@/lib/prisma/generated';
import { buildUntpArtefactUrls } from '@uncefact/untp-utils/artefacts';
import type { TtlCache } from '@uncefact/untp-utils/cache';
import type { LoadedRemoteDocument } from '@uncefact/untp-utils/loaders';
import {
  checkSchemaConformance,
  type SchemaConformanceCheckDependencies,
  type SchemaConformanceCheckInput,
} from './schema-conformance-check';

const RECORD_ID = 'crec0000000000000000000001';
const SCHEMA_URL = buildUntpArtefactUrls('DigitalProductPassport', '0.7.0').schemaUrl;
const CONTEXT_URL = 'https://contexts.example/context.json';
const ENVELOPE = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: 'EnvelopedVerifiableCredential',
  id: 'data:application/vc+jwt,header.payload.signature',
};

function dependencies(): SchemaConformanceCheckDependencies {
  const child = jest.fn(() => logger);
  logger.child.mockImplementation(child);
  return {
    schemaLoader: { load: jest.fn().mockResolvedValue({}) },
    contextCache: {} as SchemaConformanceCheckDependencies['contextCache'],
    bundledArtefactsFallback: { bundledFallback: true },
    logger,
  };
}

function input(overrides: Partial<SchemaConformanceCheckInput> = {}): SchemaConformanceCheckInput {
  return {
    recordId: RECORD_ID,
    detailsStatus: CredentialDetailsStatus.EXTRACTED,
    coreCredentialType: CoreCredentialType.DPP,
    coreDataModelVersion: '0.7.0',
    envelope: ENVELOPE,
    deadline: Date.now() + 60_000,
    signal: new AbortController().signal,
    ...overrides,
  } as SchemaConformanceCheckInput;
}

beforeEach(() => {
  jest.clearAllMocks();
  decodeCredential.mockReturnValue({ credentialSubject: { name: 'DPP' } });
  validateAgainstSchemas.mockResolvedValue(undefined);
  validateJsonLd.mockResolvedValue(undefined);
  describeJsonLdFailure.mockReturnValue({ kind: 'document', detail: 'the document is invalid', code: 'invalid' });
  createJsonLdDocumentLoader.mockReturnValue(jest.fn().mockResolvedValue({ document: {} }));
});

describe('checkSchemaConformance', () => {
  it('does not decode or fetch when details were not extracted', async () => {
    const deps = dependencies();
    const result = await checkSchemaConformance(
      input({ detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED }),
      deps,
    );

    expect(result).toEqual({ result: CheckResult.NOT_RUN, message: null });
    expect(decodeCredential).not.toHaveBeenCalled();
    expect(validateAgainstSchemas).not.toHaveBeenCalled();
  });

  it('does not decode when extracted details have no core credential type', async () => {
    const deps = dependencies();
    await expect(checkSchemaConformance(input({ coreCredentialType: null }), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
    expect(decodeCredential).not.toHaveBeenCalled();
  });

  it('does not decode when extracted details have no core data model version', async () => {
    const deps = dependencies();
    await expect(checkSchemaConformance(input({ coreDataModelVersion: null }), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
    expect(decodeCredential).not.toHaveBeenCalled();
  });

  it('uses the system core schema URL and the shared guarded loaders', async () => {
    const deps = dependencies();
    await checkSchemaConformance(input(), deps);

    expect(validateAgainstSchemas).toHaveBeenCalledWith(
      expect.anything(),
      [SCHEMA_URL],
      expect.objectContaining({ load: expect.any(Function) }),
    );
    expect(createJsonLdDocumentLoader).toHaveBeenCalledWith({
      cache: deps.contextCache,
      bundledFallback: true,
    });
    expect(validateJsonLd).toHaveBeenCalledWith(expect.anything(), { documentLoader: expect.any(Function) });
  });

  it('lets a warm context cache answer without resolving the context', async () => {
    const actual = jest.requireActual('@uncefact/untp-utils/loaders') as typeof import('@uncefact/untp-utils/loaders');
    const cached: LoadedRemoteDocument = { documentUrl: CONTEXT_URL, document: { '@context': {} } };
    const cache: TtlCache<LoadedRemoteDocument> = {
      get: jest.fn().mockResolvedValue(cached),
      invalidate: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    };

    const loader = actual.createJsonLdDocumentLoader({ cache });

    await expect(loader(CONTEXT_URL)).resolves.toBe(cached);
    expect(cache.get).toHaveBeenCalledWith(CONTEXT_URL, expect.any(Function));
  });

  it('returns the first schema violation and preserves the catch order under the base class', async () => {
    const deps = dependencies();
    validateAgainstSchemas.mockRejectedValue(
      new SchemaPayloadError([
        { code: 'type', pointer: '/credentialSubject/name', message: 'must be a string' },
        { code: 'required', pointer: '/credentialSubject/id', message: 'is required' },
      ]),
    );

    await expect(checkSchemaConformance(input(), deps)).resolves.toEqual({
      result: CheckResult.FAIL,
      message: '/credentialSubject/name (must be a string)',
    });
    expect(validateJsonLd).not.toHaveBeenCalled();
  });

  it('returns a bounded failure when the schema validator reports no location', async () => {
    const deps = dependencies();
    validateAgainstSchemas.mockRejectedValue(new SchemaPayloadError([]));

    await expect(checkSchemaConformance(input(), deps)).resolves.toEqual({
      result: CheckResult.FAIL,
      message: 'the schema validator reported a violation without a location',
    });
  });

  it('returns not_run and logs only the schema origin for fetch and compilation failures', async () => {
    const deps = dependencies();
    validateAgainstSchemas.mockRejectedValue(new SchemaFetchFailedError(SCHEMA_URL, new Error('private path')));

    await expect(checkSchemaConformance(input(), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { schemaOrigin: new URL(SCHEMA_URL).origin, errorName: 'SchemaFetchFailedError' },
      expect.any(String),
    );

    validateAgainstSchemas.mockRejectedValue(new SchemaCompilationFailedError(SCHEMA_URL, new Error('bad schema')));
    await expect(checkSchemaConformance(input(), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
  });

  it('recognises a schema-stage timeout through the validator wrapper before fetch classification', async () => {
    const deps = dependencies();
    const schemaLoader = deps.schemaLoader.load as jest.Mock;
    validateAgainstSchemas.mockImplementation(async (_payload, urls, loader) => {
      try {
        await loader.load(urls[0]);
      } catch (error) {
        throw new SchemaFetchFailedError(urls[0], error);
      }
    });

    await expect(checkSchemaConformance(input({ deadline: Date.now() - 1 }), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
    expect(schemaLoader).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { stage: 'schema', reason: 'deadline' },
      expect.stringContaining('allowance'),
    );
  });

  it('maps a document diagnostic to fail and a context diagnostic to not_run', async () => {
    const deps = dependencies();
    validateJsonLd.mockRejectedValue(new JsonLdExpansionFailedError(new Error('document failure')));
    describeJsonLdFailure.mockReturnValue({
      kind: 'document',
      detail: 'property name is not allowed',
      code: 'invalid',
    });

    await expect(checkSchemaConformance(input(), deps)).resolves.toEqual({
      result: CheckResult.FAIL,
      message: 'property name is not allowed (invalid)',
    });

    describeJsonLdFailure.mockReturnValue({ kind: 'context-fetch', detail: 'context unavailable', url: CONTEXT_URL });
    await expect(checkSchemaConformance(input(), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { stage: 'JSON-LD', contextOrigin: new URL(CONTEXT_URL).origin },
      expect.any(String),
    );

    describeJsonLdFailure.mockReturnValue({
      kind: 'context-invalid',
      detail: 'context invalid',
      code: 'invalid-context',
      fields: { event: 'context invalid' },
    });
    await expect(checkSchemaConformance(input(), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { stage: 'JSON-LD', errorCode: 'invalid-context', fields: { event: 'context invalid' } },
      expect.any(String),
    );
  });

  it('checks the deadline between schema validation and JSON-LD expansion', async () => {
    const deps = dependencies();
    const now = jest.spyOn(Date, 'now').mockReturnValueOnce(1_001);
    try {
      await expect(checkSchemaConformance(input({ deadline: 1_000 }), deps)).resolves.toEqual({
        result: CheckResult.NOT_RUN,
        message: null,
      });
      expect(validateJsonLd).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { stage: 'JSON-LD', reason: 'deadline' },
        expect.stringContaining('allowance'),
      );
    } finally {
      now.mockRestore();
    }
  });

  it('reports an aborted stage separately from a deadline', async () => {
    const deps = dependencies();
    const controller = new AbortController();
    controller.abort();
    validateAgainstSchemas.mockImplementation(async (_payload, urls, loader) => {
      await loader.load(urls[0]);
    });

    await expect(checkSchemaConformance(input({ signal: controller.signal }), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { stage: 'schema', reason: 'aborted' },
      expect.stringContaining('allowance'),
    );
  });

  it('recognises a JSON-LD stage timeout through its expansion wrapper', async () => {
    const deps = dependencies();
    const times = [100, 100, 1_100];
    jest.spyOn(Date, 'now').mockImplementation(() => times.shift() ?? 1_100);
    validateJsonLd.mockImplementation(async (_payload, options) => {
      try {
        await options.documentLoader(CONTEXT_URL);
      } catch (error) {
        throw new JsonLdExpansionFailedError(error);
      }
    });

    await expect(checkSchemaConformance(input({ deadline: 1_000 }), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { stage: 'JSON-LD', reason: 'deadline' },
      expect.stringContaining('allowance'),
    );
    jest.restoreAllMocks();
  });

  it('returns not_run for a decode defect without throwing and bounds a violation message', async () => {
    const deps = dependencies();
    decodeCredential.mockImplementationOnce(() => {
      throw new Error('decoder failed');
    });
    await expect(checkSchemaConformance(input(), deps)).resolves.toEqual({
      result: CheckResult.NOT_RUN,
      message: null,
    });
    expect(logger.error).toHaveBeenCalledWith({ errorName: 'Error' }, expect.stringContaining('could not decode'));

    decodeCredential.mockReturnValue({});
    validateAgainstSchemas.mockRejectedValue(
      new SchemaPayloadError([{ code: 'type', pointer: '/payload', message: 'x'.repeat(2_000) }]),
    );
    const result = await checkSchemaConformance(input(), deps);
    expect(result.result).toBe(CheckResult.FAIL);
    expect(result.message).toHaveLength(1_024);
    expect(result.message?.endsWith('...')).toBe(true);
  });

  it('propagates an unrecognised validator defect', async () => {
    const deps = dependencies();
    const defect = new Error('validator defect');
    validateAgainstSchemas.mockRejectedValue(defect);

    await expect(checkSchemaConformance(input(), deps)).rejects.toBe(defect);
  });
});
