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

  it('surfaces the unchanged version-detection failure copy and skips the three later steps', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue(undefined);
    render(<Harness schemes={[scheme({ id: 'x', name: 'No Context Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_VERSION_DETECTION);
    expect(screen.getByText(/Could not detect a UNTP version from the @context/)).toBeInTheDocument();
    await closeStepDetails();

    for (const stepId of [
      TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
      TestCaseStepId.SCHEME_STRUCTURAL_PARSE,
      TestCaseStepId.CONTEXT_VALIDATION,
    ]) {
      await openStepDetails(stepId);
      expect(screen.getByText('Skipped: version detection failed.')).toBeInTheDocument();
      await closeStepDetails();
    }
  });

  // The pre-0.7 prerequisite is a selection failure, not a transport failure: the uploader supplied
  // the version, so the step names the fix and offers no support link. The thrown copy itself is
  // pinned against the production code in __tests__/lib/schemeValidation.test.ts.
  it('records the pre-0.7 prerequisite failure with advice and no support link', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue('0.6.0');
    (validateSchemeSchema as jest.Mock).mockRejectedValue(
      new SchemaSelectionError('Conformity Scheme schemas have no legacy layout before UNTP 0.7.0; detected 0.6.0.'),
    );
    render(<Harness schemes={[scheme({ id: 'x', name: 'Legacy Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);
    expect(
      screen.getByText(
        /Conformity Scheme schemas have no legacy layout before UNTP 0\.7\.0; detected 0\.6\.0\. Use a Conformity Scheme published for UNTP 0\.7\.0\./,
      ),
    ).toBeInTheDocument();
    await closeStepDetails();
    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText(buildSchemaSelectionSkipMessage())).toBeInTheDocument();
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
    });
    render(<Harness schemes={[scheme({ id: 'x', name: 'Details Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    expect(await screen.findByTestId(`${TestCaseStepId.SCHEME_SCHEMA_VALIDATION}-details-trigger`)).toBeInTheDocument();
    expect(screen.queryByTestId(`${TestCaseStepId.SCHEME_STRUCTURAL_PARSE}-details-trigger`)).not.toBeInTheDocument();
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
    expect(screen.getByText('/id: scheme.id is required and must be a non-empty string.')).toBeInTheDocument();
    expect(screen.getByText('/name: scheme.name is required and must be a non-empty string.')).toBeInTheDocument();
    expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-status-icon-in-progress`)).toBeInTheDocument();
    await closeStepDetails();

    resolveContext({ valid: true });
    await waitFor(() =>
      expect(screen.getByTestId(`${TestCaseStepId.CONTEXT_VALIDATION}-status-icon-success`)).toBeInTheDocument(),
    );
  });

  it('records an unsupported parser version as a failed skip and still validates context', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue('0.7.1');
    (validateSchemeSchema as jest.Mock).mockRejectedValue(
      new SchemaFetchError(
        'https://untp.unece.org/artefacts/schema/v0.7.1/cvc/ConformityScheme.json',
        'not-found',
        'No schema published at https://untp.unece.org/artefacts/schema/v0.7.1/cvc/ConformityScheme.json (status 404).',
      ),
    );
    render(<Harness schemes={[scheme({ id: 'x', name: 'Future Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_STRUCTURAL_PARSE);
    expect(screen.getByText(buildUnsupportedParserSkipMessage('0.7.1'))).toBeInTheDocument();
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
    expect(screen.getByText('Second Scheme structural result')).toBeInTheDocument();
    expect(screen.queryByText('First Scheme structural result')).not.toBeInTheDocument();
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

  it('shows the schema service category when the schema could not be fetched', async () => {
    (validateSchemeSchema as jest.Mock).mockRejectedValue(
      new SchemaFetchError(
        'https://untp.unece.org/x.json',
        'network',
        'Schema host returned status 503 (https://untp.unece.org/x.json).',
      ),
    );
    render(<Harness schemes={[scheme({ id: 'x', name: 'Host Down Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    await openStepDetails(TestCaseStepId.SCHEME_SCHEMA_VALIDATION);
    expect(screen.getByText(/Schema host returned status 503/)).toBeInTheDocument();
    expect(screen.queryByText(/We could not reach the schema service/)).not.toBeInTheDocument();
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
