import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useEffect, useRef } from 'react';
import {
  buildSchemaSelectionSkipMessage,
  buildUnsupportedParserSkipMessage,
  SCHEME_STEP_DISPLAY_NAMES,
  SchemeTestResults,
} from '@/components/SchemeTestResults';
import { SchemaFetchError, SchemaSelectionError } from '@/lib/schemeValidation';
import { useArtefactCollection } from '@/hooks/useArtefactCollection';
import { remove, upsert } from '@/lib/artefactCollection';
import { schemeContentHash } from '@/lib/schemeCollection';
import { newId } from '@/lib/id';
import { validateSchemeSchema } from '@/lib/schemeValidation';
import { validateContext } from '@/lib/contextValidation';
import { parseSchemeStructure } from '@/lib/schemeStructure';
import { detectVersionFromContext } from '@uncefact/untp-utils/artefacts';
import type { StoredScheme, TestStep } from '@/types';
import type { CollectionState, InstanceId } from '@/types/artefact';
import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import { TestCaseStatus, TestCaseStepId } from '../../constants';

jest.mock('canvas-confetti', () => jest.fn());
jest.mock('@/components/TestResults', () => ({ confettiConfig: {}, TestResults: () => null }));
jest.mock('@/lib/schemeValidation', () => ({
  ...jest.requireActual('@/lib/schemeValidation'),
  validateSchemeSchema: jest.fn(),
}));
jest.mock('@uncefact/untp-utils/artefacts', () => ({
  ...jest.requireActual('@uncefact/untp-utils/artefacts'),
  detectVersionFromContext: jest.fn(),
}));
jest.mock('@/lib/contextValidation', () => ({ validateContext: jest.fn() }));
jest.mock('@/lib/schemeStructure', () => ({
  ...jest.requireActual('@/lib/schemeStructure'),
  parseSchemeStructure: jest.fn(),
}));

const scheme = (decoded: Record<string, unknown>, source?: StoredScheme['source']): StoredScheme => ({
  original: decoded,
  decoded,
  source,
});

type SchemeCollection = CollectionState<StoredScheme, TestStep[]>;
type SchemeDispatch = <Res extends { state: SchemeCollection }>(transition: (current: SchemeCollection) => Res) => Res;

// Harness: drives the real collection hook so the pipeline runs and the cards re-render on commit.
function Harness({ schemes }: { schemes: StoredScheme[] }) {
  const collection = useArtefactCollection<StoredScheme, TestStep[]>();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    for (const s of schemes) {
      collection.dispatch((state) =>
        upsert(state, { payload: s, contentHash: schemeContentHash(s.decoded), mintInstanceId: newId }),
      );
    }
  }, [schemes, collection]);
  return <SchemeTestResults collection={collection.state} dispatch={collection.dispatch} />;
}

function ControlledHarness({
  scheme: input,
  onReady,
}: {
  scheme: StoredScheme;
  onReady: (instanceId: InstanceId, dispatch: SchemeDispatch) => void;
}) {
  const collection = useArtefactCollection<StoredScheme, TestStep[]>();
  useEffect(() => {
    const outcome = collection.dispatch((state) =>
      upsert(state, { payload: input, contentHash: 'controlled-scheme', mintInstanceId: newId }),
    );
    onReady(outcome.outcome.instanceId, collection.dispatch);
  }, [collection.dispatch, input, onReady]);
  return <SchemeTestResults collection={collection.state} dispatch={collection.dispatch} />;
}

function RecordingHarness({
  scheme: input,
  onState,
}: {
  scheme: StoredScheme;
  onState: (state: SchemeCollection) => void;
}) {
  const collection = useArtefactCollection<StoredScheme, TestStep[]>();
  const dispatch: SchemeDispatch = useCallback(
    (transition) => {
      const outcome = collection.dispatch(transition);
      onState(outcome.state);
      return outcome;
    },
    [collection.dispatch, onState],
  );

  useEffect(() => {
    dispatch((state) => upsert(state, { payload: input, contentHash: 'recorded-scheme', mintInstanceId: newId }));
  }, [dispatch, input]);

  return <SchemeTestResults collection={collection.state} dispatch={dispatch} />;
}

const openStepDetails = async (stepId: TestCaseStepId) => {
  await userEvent.click(await screen.findByTestId(`${stepId}-details-trigger`));
  await screen.findByRole('heading', { name: 'Validation Details' });
};

const closeStepDetails = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
};

beforeEach(() => {
  jest.clearAllMocks();
  (detectVersionFromContext as jest.Mock).mockReturnValue('0.7.0');
  (validateSchemeSchema as jest.Mock).mockResolvedValue({ valid: true });
  (validateContext as jest.Mock).mockResolvedValue({ valid: true });
  (parseSchemeStructure as jest.Mock).mockReturnValue({ kind: 'parsed', scheme: {} });
});

describe('SchemeTestResults', () => {
  it('renders one card per instance in upload order', async () => {
    render(<Harness schemes={[scheme({ id: 'a', name: 'Alpha Scheme' }), scheme({ id: 'b', name: 'Beta Scheme' })]} />);

    const titles = await screen.findAllByRole('heading', { level: 3 });
    expect(titles.map((h) => h.textContent)).toEqual(['Alpha Scheme', 'Beta Scheme']);
  });

  it('shows the always-on family subtitle with the detected version, even for a nameless scheme', async () => {
    render(<Harness schemes={[scheme({ id: 'x' }, { kind: 'file', filename: 'x.json' })]} />);

    expect(await screen.findByText('Conformity Scheme (v0.7.0)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('x.json');
  });

  it('uses the scheme name as the title when present', async () => {
    render(<Harness schemes={[scheme({ id: 'x', name: 'Mining Assurance' })]} />);
    expect(await screen.findByRole('heading', { level: 3, name: 'Mining Assurance' })).toBeInTheDocument();
  });

  it('classifies version detection and marks the three later steps as not executed', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue(undefined);
    render(<Harness schemes={[scheme({ id: 'x', name: 'No Context Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_VERSION_DETECTION);
    expect(screen.getByText('We Found 1 Issue')).toBeInTheDocument();
    expect(
      screen.getByText(/The scheme declares no @context entries, so no UNTP version can be detected\./),
    ).toBeInTheDocument();
    await closeStepDetails();

    // The step row carries the status icon, name and action only. The drawer owns the skipped-state words.
    expect(screen.queryByTestId(`${TestCaseStepId.SCHEME_VERSION_DETECTION}-not-executed`)).not.toBeInTheDocument();

    for (const stepId of [
      TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
      TestCaseStepId.SCHEME_STRUCTURAL_PARSE,
      TestCaseStepId.CONTEXT_VALIDATION,
    ]) {
      const row = screen.getByTestId(`${stepId}-row`);
      const stepName = {
        [TestCaseStepId.SCHEME_SCHEMA_VALIDATION]: 'Schema Validation',
        [TestCaseStepId.SCHEME_STRUCTURAL_PARSE]: 'Structural Parse',
        [TestCaseStepId.CONTEXT_VALIDATION]: 'JSON-LD Document Expansion and Context Validation',
      }[stepId];
      expect(row.textContent).toBe(`${stepName}View Details`);
      expect(row).not.toHaveTextContent('Not executed');
      expect(row).toContainElement(screen.getByTestId(`${stepId}-status-icon-failure`));
      expect(row).toContainElement(screen.getByTestId(`${stepId}-details-trigger`));
      await openStepDetails(stepId);
      expect(screen.getByText('We Found 1 Issue')).toBeInTheDocument();
      expect(screen.getByTestId('failure-card-heading')).toHaveTextContent('Not executed');
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(/not executed because/);
      expect(
        screen.getByText('Issue: This scheme step was not executed because step "Version Detection" failed first.'),
      ).toBeInTheDocument();
      await closeStepDetails();
    }
  });

  it('drops scheme detail entries without a string message before opening the drawer', async () => {
    render(
      <SchemeTestResults
        collection={{
          items: [
            {
              instanceId: 'invalid-error-entry',
              contentHash: 'invalid-error-entry',
              payload: scheme({ id: 'invalid-error-entry', name: 'Invalid Error Entry' }),
              runId: 'settled',
              result: [
                {
                  id: TestCaseStepId.SCHEME_VERSION_DETECTION,
                  name: 'Version Detection',
                  status: TestCaseStatus.FAILURE,
                  details: {
                    errors: [{ keyword: 'required' }, { message: 'This entry is displayable.' }],
                  },
                },
              ],
            },
          ],
        }}
        dispatch={jest.fn() as SchemeDispatch}
      />,
    );

    await userEvent.click(await screen.findByTestId('scheme-group-header'));
    await userEvent.click(screen.getByTestId(`${TestCaseStepId.SCHEME_VERSION_DETECTION}-details-trigger`));

    expect(screen.getByText('We Found 1 Issue')).toBeInTheDocument();
    expect(screen.getByText('Issue: This entry is displayable.')).toBeInTheDocument();
    expect(screen.queryByText(/Missing required field/)).not.toBeInTheDocument();
  });

  it('names the observed scheme contexts when none carries a recognised version', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue(undefined);
    render(
      <Harness
        schemes={[
          scheme({ id: 'x', name: 'Unrecognised Context Scheme', '@context': ['https://example.test/context'] }),
        ]}
      />,
    );

    await userEvent.click(await screen.findByTestId('scheme-group-header'));
    await openStepDetails(TestCaseStepId.SCHEME_VERSION_DETECTION);
    expect(
      screen.getByText(/The scheme declares @context entries \["https:\/\/example\.test\/context"\]/),
    ).toBeInTheDocument();
    await closeStepDetails();
  });

  // The pre-0.7 prerequisite is a selection failure, not a transport failure: the uploader supplied
  // the version, so the step names the fix and offers no support link. The thrown copy itself is
  // pinned against the production code in __tests__/lib/schemeValidation.test.ts.
  it('records the pre-0.7 prerequisite failure with advice and no support link', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue('0.6.0');
    (validateSchemeSchema as jest.Mock).mockRejectedValue(
      new SchemaSelectionError(
        'Conformity Scheme schemas have no legacy layout before UNTP 0.7.0; detected 0.6.0.',
        'scheme-version-unsupported',
      ),
    );
    render(<Harness schemes={[scheme({ id: 'x', name: 'Legacy Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);
    expect(screen.getByText('We Found 1 Issue')).toBeInTheDocument();
    expect(
      screen.getByText(/Conformity Scheme schemas have no legacy layout before UNTP 0\.7\.0; detected 0\.6\.0\./),
    ).toBeInTheDocument();
    await closeStepDetails();
    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText('We Found 1 Issue')).toBeInTheDocument();
    expect(
      screen.getByText('Issue: This scheme step was not executed because step "Schema Validation" failed first.'),
    ).toBeInTheDocument();
    expect(parseSchemeStructure).not.toHaveBeenCalled();
    expect(validateContext).toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'report an issue' })).not.toBeInTheDocument();
    await closeStepDetails();
  });

  it('renders the four scheme steps in pipeline order', async () => {
    render(<Harness schemes={[scheme({ id: 'x', name: 'Ordered Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    expect(
      screen
        .getAllByText(
          /^(Version Detection|Schema Validation|Structural Parse|JSON-LD Document Expansion and Context Validation)$/,
        )
        .map((node) => node.textContent),
    ).toEqual([
      'Version Detection',
      'Schema Validation',
      'Structural Parse',
      'JSON-LD Document Expansion and Context Validation',
    ]);
  });

  it('shows View Details for a failed step but not for a successful step', async () => {
    (validateSchemeSchema as jest.Mock).mockResolvedValue({
      valid: false,
      errors: [{ keyword: 'required', instancePath: '', message: 'must have required property', params: {} }],
      failure: {
        class: 'credential-invalid',
        code: 'schema.validation.payload',
        message: 'The scheme failed against the fetched schema.',
        remediation: 'Correct the named field in the scheme.',
      },
    });
    render(<Harness schemes={[scheme({ id: 'x', name: 'Details Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    expect(await screen.findByTestId(`${TestCaseStepId.SCHEME_SCHEMA_VALIDATION}-details-trigger`)).toBeInTheDocument();
    expect(screen.queryByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-details-trigger`)).not.toBeInTheDocument();
  });

  it('keeps the remove control inside the expanded header row', async () => {
    render(<Harness schemes={[scheme({ id: 'header-only', name: 'Header Only Scheme' })]} />);

    const removeButton = await screen.findByRole('button', { name: 'Remove Header Only Scheme' });
    await userEvent.click(screen.getByTestId('scheme-group-header'));

    const header = screen.getByTestId('scheme-group-header');
    const body = screen.getByTestId('scheme-group-body');
    expect(header.contains(removeButton)).toBe(true);
    expect(body.contains(removeButton)).toBe(false);
  });

  it('keeps both structural skip copies free of every step display name', () => {
    const skipMessages = [buildSchemaSelectionSkipMessage(), buildUnsupportedParserSkipMessage('0.7.1')];

    for (const message of skipMessages) {
      for (const stepName of SCHEME_STEP_DISPLAY_NAMES) expect(message).not.toContain(stepName);
    }
  });

  it('shows every structural failure while context validation is still in progress', async () => {
    let resolveContext!: (value: { valid: boolean }) => void;
    (validateContext as jest.Mock).mockReturnValue(
      new Promise<{ valid: boolean }>((resolve) => {
        resolveContext = resolve;
      }),
    );
    (parseSchemeStructure as jest.Mock).mockReturnValue({
      kind: 'document-failure',
      errors: [
        { message: '/id: scheme.id is required and must be a non-empty string.', supportable: false },
        { message: '/name: scheme.name is required and must be a non-empty string.', supportable: false },
      ],
      diagnostics: [
        { code: 'conformity-scheme.missing-required-field', message: 'id', pointer: '/id' },
        { code: 'conformity-scheme.missing-required-field', message: 'name', pointer: '/name' },
      ],
    });
    render(<Harness schemes={[scheme({ id: 'x', name: 'Structural Failure' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText(/We Found 2 Issues/)).toBeInTheDocument();
    expect(screen.getByText('Location: id')).toBeInTheDocument();
    expect(screen.getByText('Issue: scheme.id is required and must be a non-empty string.')).toBeInTheDocument();
    expect(screen.getByText('Location: name')).toBeInTheDocument();
    expect(screen.getByText('Issue: scheme.name is required and must be a non-empty string.')).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-status-icon-in-progress`)).toBeInTheDocument();
    await closeStepDetails();

    resolveContext({ valid: true });
    await waitFor(() =>
      expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-status-icon-success`)).toBeInTheDocument(),
    );
  });

  it('shows a context fetch failure as one issue card', async () => {
    const contextUrl = 'https://publisher.example/context.jsonld';
    const diagnostic = `Couldn't load the @context at "${contextUrl}". Common causes: the URL is unreachable, is not https, resolves to a private address, redirected too many times, or returned a non-JSON-LD response. Reported cause: the context service answered status 503.`;
    (validateContext as jest.Mock).mockResolvedValue({
      valid: false,
      error: { keyword: 'jsonldUrl', message: diagnostic, instancePath: '@context', params: {} },
      failure: {
        class: 'could-not-fetch',
        code: 'context.fetch',
        message: `The Playground's context service answered 503 while fetching "${contextUrl}".`,
        remediation:
          'Retry the check. If it keeps failing, report the URL and these details to the Playground operator.',
        artefactUrl: contextUrl,
        serviceStatus: 503,
      },
    });
    render(<Harness schemes={[scheme({ id: 'x', name: 'Context Failure Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));
    await openStepDetails(TestCaseStepId.CONTEXT_VALIDATION);

    const card = screen.getByTestId('validation-issue-card');
    expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(1);
    expect(card).toHaveTextContent(`The Playground's context service answered 503 while fetching "${contextUrl}".`);
    expect(card).toHaveTextContent(contextUrl);
    expect(card).toHaveTextContent(
      'Retry the check. If it keeps failing, report the URL and these details to the Playground operator.',
    );
    expect(card).not.toHaveTextContent(/Common causes:/);
    expect(card).not.toHaveTextContent(/Reported cause:/);
    await closeStepDetails();
  });

  it('records an unsupported parser version as a failed skip and still validates context', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue('0.7.1');
    (validateSchemeSchema as jest.Mock).mockRejectedValue(
      new SchemaFetchError({
        code: 'playground.schema.fetch',
        message:
          'No schema published at https://untp.unece.org/artefacts/schema/v0.7.1/cvc/ConformityScheme.json (status 404).',
        schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.1/cvc/ConformityScheme.json',
        category: 'upstream-status',
        reason: 'not-found',
        serviceStatus: 502,
        upstreamStatus: 404,
      }),
    );
    render(<Harness schemes={[scheme({ id: 'x', name: 'Future Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);
    expect(screen.getByText(/No schema published at/)).toBeInTheDocument();
    await closeStepDetails();
    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText(/Skipped: the Playground has no parser for UNTP 0\.7\.1/)).toBeInTheDocument();
    expect(parseSchemeStructure).not.toHaveBeenCalled();
    expect(validateContext).toHaveBeenCalled();
    await closeStepDetails();
  });

  it('settles structural parsing after an adapter throw and continues to context validation', async () => {
    (parseSchemeStructure as jest.Mock).mockImplementation(() => {
      throw new TypeError('adapter failed');
    });
    render(<Harness schemes={[scheme({ id: 'x', name: 'Throwing Adapter' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText(/The Playground could not complete this check: adapter failed\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'report an issue' })).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-status-icon-failure`)).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-status-icon-in-progress`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-status-icon-success`)).toBeInTheDocument();
    await closeStepDetails();
  });

  it('settles every unfinished step when the outer runner throws during a state commit', async () => {
    let latestState: SchemeCollection | undefined;
    let throwOnce = true;
    const onState = (state: SchemeCollection) => {
      latestState = state;
      const firstStep = state.items[0]?.result?.[0];
      if (throwOnce && firstStep?.status === TestCaseStatus.IN_PROGRESS) {
        throwOnce = false;
        throw new Error('state commit failed');
      }
    };
    const toastSpy = jest.spyOn(toast, 'error').mockImplementation(() => undefined as never);

    render(<RecordingHarness scheme={scheme({ id: 'x', name: 'Outer Failure Scheme' })} onState={onState} />);

    await waitFor(() => {
      const steps = latestState?.items[0]?.result;
      expect(steps).toHaveLength(4);
      expect(steps?.every((step) => step.status === TestCaseStatus.FAILURE)).toBe(true);
    });
    const steps = latestState?.items[0]?.result ?? [];
    expect(steps).toEqual(
      expect.arrayContaining(
        steps.map((step) =>
          expect.objectContaining({
            id: step.id,
            status: TestCaseStatus.FAILURE,
            failure: expect.objectContaining({
              class: 'unknown',
              code: 'playground.pipeline.unexpected',
            }),
          }),
        ),
      ),
    );
    expect(toastSpy).toHaveBeenCalledTimes(1);
    toastSpy.mockRestore();
  });

  it('records unsupported-version diagnostics on the structural step', async () => {
    (parseSchemeStructure as jest.Mock).mockReturnValue({
      kind: 'unsupported-version',
      received: '0.7.1',
      expected: ['0.7.0'],
      message: "CVC spec version '0.7.1' is not supported by the Playground.",
      supportable: true,
    });
    let latestState: SchemeCollection | undefined;
    const onState = (state: SchemeCollection) => {
      latestState = state;
    };
    render(<RecordingHarness scheme={scheme({ id: 'x', name: 'Unsupported Scheme' })} onState={onState} />);

    await waitFor(() => expect(parseSchemeStructure).toHaveBeenCalled());
    const step = latestState?.items[0]?.result?.find(
      (candidate) => candidate.id === TestCaseStepId.SCHEME_STRUCTURAL_PARSE,
    );
    expect(step?.details).toEqual({
      errors: [
        {
          message: "CVC spec version '0.7.1' is not supported by the Playground.",
          supportable: true,
        },
      ],
      diagnostics: [
        {
          code: 'conformity-scheme.unsupported-spec-version',
          message: "CVC spec version '0.7.1' is not supported by the Playground.",
          received: '0.7.1',
          expected: ['0.7.0'],
        },
      ],
    });
  });

  it('does not parse the superseded document after replacement during schema validation', async () => {
    let resolveSchema!: (value: { valid: boolean }) => void;
    (validateSchemeSchema as jest.Mock).mockReturnValue(
      new Promise<{ valid: boolean }>((resolve) => {
        resolveSchema = resolve;
      }),
    );
    const onReady = jest.fn();
    const first = scheme({ id: 'first', name: 'First Scheme' });
    const second = scheme({ id: 'second', name: 'Second Scheme' });
    (parseSchemeStructure as jest.Mock).mockImplementation((document: Record<string, unknown>) => ({
      kind: 'document-failure',
      errors: [{ message: `${document.name} structural result`, supportable: false }],
      diagnostics: [{ code: 'test.structural-failure', message: 'test', pointer: '/name' }],
    }));
    const view = render(<ControlledHarness scheme={first} onReady={onReady} />);

    await waitFor(() => expect(validateSchemeSchema).toHaveBeenCalledTimes(1));
    view.rerender(<ControlledHarness scheme={second} onReady={onReady} />);
    await waitFor(() => expect(validateSchemeSchema).toHaveBeenCalledTimes(2));

    resolveSchema({ valid: true });
    await waitFor(() => expect(parseSchemeStructure).toHaveBeenCalledTimes(1));
    expect(parseSchemeStructure).toHaveBeenCalledWith(second.decoded, expect.anything());
    expect(parseSchemeStructure).not.toHaveBeenCalledWith(first.decoded, expect.anything());
    await userEvent.click(screen.getByTestId('scheme-group-header'));
    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText(/Second Scheme structural result/)).toBeInTheDocument();
    expect(screen.queryByText(/First Scheme structural result/)).not.toBeInTheDocument();
    await closeStepDetails();
  });

  it('keeps the overall verdict pending and does not show confetti while Structural Parse is pending', () => {
    const steps: TestStep[] = [
      { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection', status: TestCaseStatus.SUCCESS },
      { id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION, name: 'Schema Validation', status: TestCaseStatus.SUCCESS },
      { id: TestCaseStepId.SCHEME_STRUCTURAL_PARSE, name: 'Structural Parse', status: TestCaseStatus.PENDING },
      {
        id: TestCaseStepId.CONTEXT_VALIDATION,
        name: 'JSON-LD Document Expansion and Context Validation',
        status: TestCaseStatus.SUCCESS,
      },
    ];
    render(
      <SchemeTestResults
        collection={{
          items: [
            {
              instanceId: 'pending-structural',
              contentHash: 'pending-structural',
              payload: scheme({ id: 'pending', name: 'Pending Structural Scheme' }),
              result: steps,
              runId: 'run',
            },
          ],
        }}
        dispatch={jest.fn() as SchemeDispatch}
      />,
    );

    expect(screen.getByTestId('pending-structural-status-icon-in-progress')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-structural-status-icon-success')).not.toBeInTheDocument();
    expect(confetti).not.toHaveBeenCalled();
  });

  it('does not parse an obsolete document after removal during schema validation', async () => {
    let resolveSchema!: (value: { valid: boolean }) => void;
    (validateSchemeSchema as jest.Mock).mockReturnValue(
      new Promise<{ valid: boolean }>((resolve) => {
        resolveSchema = resolve;
      }),
    );
    const onReady = jest.fn();
    const input = scheme({ id: 'removed', name: 'Removed Scheme' });
    render(<ControlledHarness scheme={input} onReady={onReady} />);
    await waitFor(() => expect(validateSchemeSchema).toHaveBeenCalledTimes(1));
    const [instanceId, dispatch] = onReady.mock.calls[0] as [InstanceId, SchemeDispatch];

    await act(async () => {
      dispatch((state) => remove(state, instanceId));
    });
    resolveSchema({ valid: true });
    await waitFor(() => expect(parseSchemeStructure).not.toHaveBeenCalled());
  });

  it('reports a scheme schema URL builder failure as a Playground fault with support', async () => {
    (validateSchemeSchema as jest.Mock).mockRejectedValue(
      new SchemaSelectionError('The Playground could not build a scheme schema URL: invalid version.', 'builder'),
    );
    render(<Harness schemes={[scheme({ id: 'x', name: 'Builder Failure Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));
    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);

    expect(
      (await screen.findAllByText(/The Playground could not build a scheme schema URL: invalid version/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
      'Report these details to the Playground operator.',
    );
    expect(screen.getByRole('link', { name: 'report an issue' })).toBeInTheDocument();
    expect(screen.queryByText(/Use a Conformity Scheme published/)).not.toBeInTheDocument();
    await closeStepDetails();
  });

  it('shows the schema fetch failure as one issue card', async () => {
    (validateSchemeSchema as jest.Mock).mockRejectedValue(
      new SchemaFetchError({
        code: 'playground.schema.fetch',
        message: 'Schema host returned status 503 (https://untp.unece.org/x.json).',
        schemaUrl: 'https://untp.unece.org/x.json',
        category: 'upstream-status',
        reason: 'network',
        serviceStatus: 503,
      }),
    );
    render(<Harness schemes={[scheme({ id: 'x', name: 'Host Down Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);
    const card = screen.getByTestId('validation-issue-card');
    expect(card).toHaveTextContent('The Playground could not fetch the artefact');
    expect(card).toHaveTextContent('https://untp.unece.org/x.json');
    expect(card).toHaveTextContent('Retry the check');
    await closeStepDetails();
  });

  it('shows a schema timeout as an issue card without an unexpected-failure toast', async () => {
    (validateSchemeSchema as jest.Mock).mockRejectedValue(
      new SchemaFetchError({
        code: 'playground.schema.fetch',
        message: 'Schema fetch timed out after 15s.',
        schemaUrl: 'https://untp.unece.org/x.json',
        category: 'uncoded',
        reason: 'timeout',
        browserSide: true,
      }),
    );
    const toastSpy = jest.spyOn(toast, 'error').mockImplementation(() => undefined as never);
    render(<Harness schemes={[scheme({ id: 'x', name: 'Timed Out Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));
    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);

    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
      'The Playground could not fetch the artefact',
    );
    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent('https://untp.unece.org/x.json');
    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent('Retry the check');
    expect(toastSpy).not.toHaveBeenCalled();
    toastSpy.mockRestore();
    await closeStepDetails();
  });

  it('removes a card only after the confirmation dialog is confirmed', async () => {
    render(<Harness schemes={[scheme({ id: 'x', name: 'Removable Scheme' })]} />);
    expect(await screen.findByRole('heading', { level: 3, name: 'Removable Scheme' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Removable Scheme' }));
    expect(await screen.findByText('Remove Removable Scheme?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 3, name: 'Removable Scheme' })).not.toBeInTheDocument();
    });
  });

  it('keeps the card when the removal is cancelled', async () => {
    render(<Harness schemes={[scheme({ id: 'x', name: 'Keep Me' })]} />);
    await screen.findByRole('heading', { level: 3, name: 'Keep Me' });

    await userEvent.click(screen.getByRole('button', { name: 'Remove Keep Me' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { level: 3, name: 'Keep Me' })).toBeInTheDocument();
  });
});
