/**
 * @jest-environment node
 */
// jsonld runs for real here (through utils' expandJsonLd); only the document
// loader is replaced, with one that serves the bundled UNTP and VCDM contexts,
// so expansion is exercised offline against the published context documents.
import type { LoadedRemoteDocument } from '@uncefact/untp-utils/loaders';

const mockLoad = jest.fn<Promise<LoadedRemoteDocument>, [string]>();

jest.mock('@uncefact/untp-utils/validation', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/validation');
  return { ...actual, expandJsonLd: jest.fn(actual.expandJsonLd) };
});

jest.mock('@uncefact/untp-utils/loaders', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/loaders');
  return { ...actual, createJsonLdDocumentLoader: jest.fn(() => (url: string) => mockLoad(url)) };
});

import { findBundledArtefact } from '@uncefact/untp-utils/bundled-artefacts';
import { PrivateAddressError } from '@uncefact/untp-utils/node';
import { POST } from '@/app/api/context/route';

const VCDM = 'https://www.w3.org/ns/credentials/v2';
const UNTP = 'https://vocabulary.uncefact.org/untp/0.7.0/context/';

async function bundledLoader(url: string): Promise<LoadedRemoteDocument> {
  const document = await findBundledArtefact(url);
  if (!document) throw new Error(`not bundled: ${url}`);
  return { documentUrl: url, document };
}

function post(body: unknown, raw = false): Request {
  return new Request('http://localhost/api/context', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const dpp = {
  '@context': [VCDM, UNTP],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  issuer: { type: ['CredentialIssuer'], id: 'did:web:example.com', name: 'Example' },
  credentialSubject: { type: ['Product'], id: 'https://example.com/products/1', name: 'Widget' },
};

describe('POST /api/context', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockLoad.mockImplementation(bundledLoader);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('expands a credential whose contexts resolve, returning the expanded document', async () => {
    const response = await POST(post({ document: dpp }));
    const json = (await response.json()) as { expanded: unknown[] };
    expect(response.status).toBe(200);

    expect(Array.isArray(json.expanded)).toBe(true);
    expect(JSON.stringify(json.expanded)).toContain('https://www.w3.org/2018/credentials#issuer');
    expect(mockLoad).toHaveBeenCalledWith(VCDM);
    expect(mockLoad).toHaveBeenCalledWith(UNTP);
  });

  it.each([
    ['a body that is not JSON', post('{nope', true)],
    ['a body without a document', post({})],
    ['an array document', post({ document: [] })],
  ])('rejects %s with 400 before loading anything', async (_label, request) => {
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { failure: { kind: string } }).failure.kind).toBe('request');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('reports a property no context defines as a safe-mode document failure naming the property', async () => {
    // Under the VCDM context alone: the UNTP context scopes a vocabulary onto
    // its types, so an unknown property there expands rather than failing.
    const response = await POST(
      post({ document: { '@context': [VCDM], type: ['VerifiableCredential'], mediaQuery: 'foo' } }),
    );
    const json = (await response.json()) as { error: string; failure: Record<string, unknown> };
    expect(response.status).toBe(422);
    expect(json.failure).toMatchObject({
      kind: 'document',
      source: 'safe-mode-event',
      code: 'invalid property',
      fields: { property: 'mediaQuery' },
    });
  });

  it('reports a malformed @context entry as a document syntax failure with its code', async () => {
    const response = await POST(post({ document: { '@context': [VCDM, 42], type: ['VerifiableCredential'] } }));
    const json = (await response.json()) as { error: string; failure: Record<string, unknown> };
    expect(response.status).toBe(422);
    expect(json.failure).toMatchObject({ kind: 'document', source: 'syntax-error', code: 'invalid local context' });
  });

  it("reports the loader's refusal as a context-fetch failure that names the URL but not the address", async () => {
    const blocked = 'https://internal.example/ctx.jsonld';
    mockLoad.mockImplementation(async (url) => {
      if (url === blocked) throw new PrivateAddressError('internal.example', ['10.0.0.9']);
      return bundledLoader(url);
    });
    const response = await POST(post({ document: { '@context': [VCDM, blocked], type: ['VerifiableCredential'] } }));
    const json = (await response.json()) as { error: string; failure: Record<string, unknown> };
    expect(response.status).toBe(422);
    expect(json.failure).toEqual({
      kind: 'context-fetch',
      detail: "a remote @context URL was rejected by this service's URL policy or could not be resolved",
      url: blocked,
    });
    expect(JSON.stringify(json.failure)).not.toContain('10.0.0.9');
  });

  it('logs the typed cause of a 422 server-side, with the guard code, while the response stays flat', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const blocked = 'https://internal.example/ctx.jsonld';
    mockLoad.mockImplementation(async (url) => {
      if (url === blocked) throw new PrivateAddressError('internal.example', ['10.0.0.9']);
      return bundledLoader(url);
    });
    const response = await POST(post({ document: { '@context': [VCDM, blocked], type: ['VerifiableCredential'] } }));
    expect(response.status).toBe(422);
    expect(warn).toHaveBeenCalledWith(
      'JSON-LD expansion failed',
      expect.objectContaining({ kind: 'context-fetch', url: blocked, code: 'url.private-address' }),
    );
    warn.mockRestore();
  });

  it('warns when a bundled context stands in for a failed fetch, naming the URL and codes', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.isolateModules(() => {
      const { createJsonLdDocumentLoader: createLoader } = jest.requireMock('@uncefact/untp-utils/loaders');
      createLoader.mockClear();
      jest.requireActual('@/app/api/context/route');
      const { onBundledFallback, allowedSchemes } = createLoader.mock.calls[0][0];
      expect(allowedSchemes).toEqual(['https']);
      onBundledFallback({
        url: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
        cause: Object.assign(new Error('HTTP 503'), { code: 'resolver.http-error', cause: { code: 'inner' } }),
      });
    });
    expect(warn).toHaveBeenCalledWith('Served the bundled copy of a JSON-LD context because its fetch failed', {
      url: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
      code: 'resolver.http-error',
      causeCode: 'inner',
    });
    warn.mockRestore();
  });

  it('answers 500 with a service message, never a document fault, when expansion throws a non-JSON-LD error', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    // A loader throw is rehydrated into the JSON-LD error class, so the
    // non-JSON-LD throw has to come from the module boundary itself.
    const { expandJsonLd } = jest.requireMock('@uncefact/untp-utils/validation');
    (expandJsonLd as jest.Mock).mockRejectedValueOnce(new RangeError('out of memory'));
    const response = await POST(post({ document: { '@context': [VCDM], type: ['VerifiableCredential'] } }));
    const json = (await response.json()) as { error: string; failure: Record<string, unknown> };
    expect(response.status).toBe(500);
    expect(json.failure).toEqual({
      kind: 'service',
      detail: 'The context service hit an internal error. Retry in a moment.',
    });
    expect(JSON.stringify(json.failure)).not.toContain('out of memory');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('reports a fetched but unusable context as context-invalid', async () => {
    const notAContext = 'https://example.com/not-a-context.json';
    mockLoad.mockImplementation(async (url) => {
      if (url === notAContext) return { documentUrl: url, document: [1, 2, 3] };
      return bundledLoader(url);
    });
    const response = await POST(
      post({ document: { '@context': [VCDM, notAContext], type: ['VerifiableCredential'] } }),
    );
    const json = (await response.json()) as { error: string; failure: Record<string, unknown> };
    expect(response.status).toBe(422);
    expect(json.failure).toMatchObject({ kind: 'context-invalid', code: 'invalid remote context', url: notAContext });
  });
});
