import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef } from 'react';
import validSample from '../../e2e/cypress/fixtures/conformity-schemes-e2e/v0.7.0-valid.json';
import cvcSchema from '../../../untp-utils/artefacts/schema/untp/0.7.0/cvc.json';
import { buildUnsupportedParserSkipMessage, SchemeTestResults } from '@/components/SchemeTestResults';
import { bundledLoader } from '../helpers/bundledLoader';
import { useArtefactCollection } from '@/hooks/useArtefactCollection';
import { upsert } from '@/lib/artefactCollection';
import { schemaCache } from '@/lib/schemaFetch';
import { schemeContentHash } from '@/lib/schemeCollection';
import { newId } from '@/lib/id';
import * as schemeStructure from '@/lib/schemeStructure';
import { expandJsonLd } from '@uncefact/untp-utils/validation';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import type { StoredScheme, TestStep } from '@/types';
import { TestCaseStepId } from '../../constants';
import { toast } from 'sonner';

jest.mock('canvas-confetti', () => jest.fn());
jest.mock('@/components/TestResults', () => ({ confettiConfig: {}, TestResults: () => null }));
jest.mock('@/lib/schemeStructure', () => {
  const actual = jest.requireActual('@/lib/schemeStructure');
  return { ...actual, parseSchemeStructure: jest.fn(actual.parseSchemeStructure) };
});

const originalFetch = global.fetch;
let schemaRequests = 0;
let contextRequests = 0;
let requestedSchemaUrl = '';
let schemaResponder: () => Response;
let contextResponder: (document: Record<string, unknown>) => Promise<Response>;
let parserSpy: jest.SpyInstance;

beforeAll(() => {
  Object.defineProperty(globalThis, 'TextDecoder', { value: NodeTextDecoder, configurable: true });
  Object.defineProperty(globalThis, 'TextEncoder', { value: NodeTextEncoder, configurable: true });
  Object.defineProperty(globalThis, 'structuredClone', {
    value: function clone<T>(value: T): T {
      return JSON.parse(JSON.stringify(value)) as T;
    },
    configurable: true,
  });
});

const scheme = (decoded: Record<string, unknown>): StoredScheme => ({
  original: decoded,
  decoded,
  source: { kind: 'file', filename: 'integration-scheme.json' },
});

function Harness({ input }: { input: StoredScheme }) {
  const collection = useArtefactCollection<StoredScheme, TestStep[]>();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    collection.dispatch((state) =>
      upsert(state, { payload: input, contentHash: schemeContentHash(input.decoded), mintInstanceId: newId }),
    );
  }, [collection, input]);
  return <SchemeTestResults collection={collection.state} dispatch={collection.dispatch} />;
}

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

const openStepDetails = async (stepId: TestCaseStepId) => {
  await userEvent.click(await screen.findByTestId(`${stepId}-details-trigger`));
  await screen.findByRole('heading', { name: 'Validation Details' });
};

const closeStepDetails = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
};

beforeEach(async () => {
  await schemaCache.clear();
  schemaRequests = 0;
  contextRequests = 0;
  requestedSchemaUrl = '';
  schemaResponder = () => response(cvcSchema);
  contextResponder = async (document) => {
    const expanded = await expandJsonLd(document, { documentLoader: bundledLoader });
    return response({ expanded });
  };
  parserSpy = schemeStructure.parseSchemeStructure as unknown as jest.SpyInstance;
  parserSpy.mockClear();
  global.fetch = jest.fn(async (input, init) => {
    const url = String(input);
    if (url.startsWith('/api/schema?url=')) {
      schemaRequests += 1;
      requestedSchemaUrl = new URL(url, 'http://localhost').searchParams.get('url') ?? '';
      return schemaResponder();
    }
    if (url === '/api/context') {
      contextRequests += 1;
      const body = JSON.parse(String(init?.body)) as { document: Record<string, unknown> };
      return contextResponder(body.document);
    }
    throw new Error(`Unexpected transport request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('SchemeTestResults with the real scheme pipeline', () => {
  it('passes all four checks for the supported valid scheme', async () => {
    render(<Harness input={scheme(validSample as Record<string, unknown>)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    for (const stepId of [
      TestCaseStepId.SCHEME_VERSION_DETECTION,
      TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
      TestCaseStepId.SCHEME_STRUCTURAL_PARSE,
      TestCaseStepId.CONTEXT_VALIDATION,
    ]) {
      expect(await screen.findByTestId(`${stepId}-status-icon-success`)).toBeInTheDocument();
    }
  });

  it('runs Ajv and the parser after an Ajv failure, retaining both missing-field diagnoses', async () => {
    const document = { ...(validSample as Record<string, unknown>) } as Record<string, unknown>;
    delete document.id;
    delete document.name;
    render(<Harness input={scheme(document)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText('/id: scheme.id is required and must be a non-empty string.')).toBeInTheDocument();
    expect(screen.getByText('/name: scheme.name is required and must be a non-empty string.')).toBeInTheDocument();
    await closeStepDetails();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_SCHEMA_VALIDATION}-status-icon-failure`)).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-status-icon-failure`)).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-status-icon-success`)).toBeInTheDocument();
  });

  it('runs structural parsing after a schema transport failure', async () => {
    const document = { ...(validSample as Record<string, unknown>) } as Record<string, unknown>;
    delete document.id;
    delete document.name;
    schemaResponder = () => response({ error: 'Schema host returned status 502' }, 502);
    render(<Harness input={scheme(document)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText('/id: scheme.id is required and must be a non-empty string.')).toBeInTheDocument();
    expect(screen.getByText('/name: scheme.name is required and must be a non-empty string.')).toBeInTheDocument();
    await closeStepDetails();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-status-icon-failure`)).toBeInTheDocument();
  });

  it('keeps Ajv and Context passing while the parser rejects a blank scheme name', async () => {
    const document = { ...(validSample as Record<string, unknown>), name: '   ' };
    render(<Harness input={scheme(document)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText(/\/name: scheme\.name is required/)).toBeInTheDocument();
    await closeStepDetails();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_SCHEMA_VALIDATION}-status-icon-success`)).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-status-icon-success`)).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-status-icon-failure`)).toBeInTheDocument();
  });

  it.each([
    ['missing owner', (document: Record<string, unknown>) => delete document.owner],
    [
      'invalid endorsementLevel',
      (document: Record<string, unknown>) => (document.endorsementLevel = 'not-a-real-level'),
    ],
  ])('keeps the schema gate independent when the parser accepts a document with %s', async (_case, mutate) => {
    const document = { ...(validSample as Record<string, unknown>) } as Record<string, unknown>;
    mutate(document);
    render(<Harness input={scheme(document)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    expect(
      await screen.findByTestId(`${TestCaseStepId.SCHEME_SCHEMA_VALIDATION}-status-icon-failure`),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-status-icon-success`)).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-status-icon-success`)).toBeInTheDocument();
  });

  it('shows every schema-required root field in View Details when Ajv reports one grouped issue', async () => {
    const document = { ...(validSample as Record<string, unknown>) } as Record<string, unknown>;
    delete document.owner;
    delete document.documentation;
    render(<Harness input={scheme(document)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));
    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);

    expect(screen.getByText('Missing required field: owner')).toBeInTheDocument();
    expect(screen.getByText('Missing required field: documentation')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /fix validation error/i }));

    expect(screen.getByText((_, element) => element?.textContent === 'Missing field: owner')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === 'Missing field: documentation'),
    ).toBeInTheDocument();
  });

  it('continues to context validation for a detected 0.6.0 scheme without fetching a schema', async () => {
    const document = { ...(validSample as Record<string, unknown>) } as Record<string, unknown>;
    document['@context'] = ['https://test.uncefact.org/vocabulary/untp/dcc/0.6.0/'];
    const contextUrl = String((document['@context'] as string[])[0]);
    contextResponder = async () =>
      response(
        {
          failure: {
            kind: 'context-fetch',
            code: 'resolver.http-error',
            detail: 'context host returned status 503',
            url: contextUrl,
            upstreamStatus: 503,
          },
        },
        422,
      );
    const toastSpy = jest.spyOn(toast, 'error').mockImplementation(() => undefined as never);
    try {
      render(<Harness input={scheme(document)} />);

      await userEvent.click(await screen.findByTestId('scheme-group-header'));

      expect(schemaRequests).toBe(0);
      await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
      expect(
        screen.getByText('This scheme step was not executed because step "Schema Validation" failed first.'),
      ).toBeInTheDocument();
      expect(screen.queryByText(buildUnsupportedParserSkipMessage('0.6.0'))).not.toBeInTheDocument();
      await closeStepDetails();
      expect(parserSpy).not.toHaveBeenCalled();
      expect(await screen.findByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-status-icon-failure`)).toBeInTheDocument();
      expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-row`)).toHaveTextContent('Could not fetch');
      expect(screen.queryByText('Could not determine the cause')).not.toBeInTheDocument();
      expect(contextRequests).toBe(1);
      expect(toastSpy).not.toHaveBeenCalled();
    } finally {
      toastSpy.mockRestore();
    }
  });

  it.each([403, 404])('classifies a schema %s as not published for the declared version', async (status) => {
    const document = { ...(validSample as Record<string, unknown>) } as Record<string, unknown>;
    document['@context'] = ['https://test.uncefact.org/vocabulary/untp/dcc/0.7.0-rc.1/'];
    schemaResponder = () =>
      response(
        { error: `Schema host returned status ${status}`, code: 'upstream-status', upstreamStatus: status },
        502,
      );
    contextResponder = async () => response({ expanded: [] });
    render(<Harness input={scheme(document)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    expect(schemaRequests).toBe(1);
    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);
    expect(requestedSchemaUrl).not.toBe('');
    const expectedSchemaMessage = `The schema at "${requestedSchemaUrl}" returned HTTP status ${status}; it was not published for declared version 0.7.0-rc.1.`;
    expect(screen.getAllByText(expectedSchemaMessage).length).toBeGreaterThan(0);
    await closeStepDetails();
    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(
      screen.getByText(/The declared Conformity Scheme version "0\.7\.0-rc\.1" has no parser/),
    ).toBeInTheDocument();
    await closeStepDetails();
    expect(parserSpy).not.toHaveBeenCalled();
    expect(contextRequests).toBe(1);
  });

  it.each([403, 404])('classifies a context %s as not published for the declared version', async (status) => {
    const document = { ...(validSample as Record<string, unknown>) } as Record<string, unknown>;
    const contextUrl = String((document['@context'] as string[])[0]);
    contextResponder = async () =>
      response(
        {
          failure: {
            kind: 'context-fetch',
            code: 'resolver.http-error',
            detail: `Context host returned status ${status}`,
            url: contextUrl,
            upstreamStatus: status,
          },
        },
        422,
      );
    render(<Harness input={scheme(document)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));
    await openStepDetails(TestCaseStepId.CONTEXT_VALIDATION);

    const expectedContextMessage = `The context at "${contextUrl}" returned HTTP status ${status}; it was not published for declared version 0.7.0.`;
    expect(screen.getAllByText(expectedContextMessage).length).toBeGreaterThan(0);
    expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-row`)).toHaveTextContent('Scheme invalid');
    expect(screen.getByText(/correct the scheme's declared @context version/i)).toBeInTheDocument();
    await closeStepDetails();
  });

  it('classifies an upstream invalid JSON schema response as an unusable artefact', async () => {
    const document = { ...(validSample as Record<string, unknown>) } as Record<string, unknown>;
    schemaResponder = () => response({ error: 'Schema body was not JSON', code: 'invalid-json' }, 502);
    render(<Harness input={scheme(document)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));
    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);

    expect(screen.getByText(/was fetched but its response was not valid JSON/)).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_SCHEMA_VALIDATION}-row`)).toHaveTextContent('Unusable artefact');
    await closeStepDetails();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-status-icon-success`)).toBeInTheDocument();
  });

  it('detects 0.7.0 when the context URL has no trailing slash while the schema judges the literal', async () => {
    const document = { ...(validSample as Record<string, unknown>), name: ' ' } as Record<string, unknown>;
    document['@context'] = ['https://vocabulary.uncefact.org/untp/0.7.0'];
    render(<Harness input={scheme(document)} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_VERSION_DETECTION}-status-icon-success`)).toBeInTheDocument();
    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);
    await userEvent.click(screen.getByRole('button', { name: /use the correct value/i }));
    expect(screen.getByText('Issue: must be equal to constant')).toBeInTheDocument();
    await closeStepDetails();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_SCHEMA_VALIDATION}-status-icon-failure`)).toBeInTheDocument();
    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    const structuralMessage = screen.getByText(/\/name: scheme\.name is required/);
    expect(structuralMessage).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-status-icon-failure`)).toBeInTheDocument();
    expect(structuralMessage.closest('li')?.querySelector('a')).toBeNull();
    await closeStepDetails();
  });
});
