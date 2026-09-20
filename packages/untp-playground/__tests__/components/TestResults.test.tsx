import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState } from 'react';
import { TestResults, confettiConfig } from '@/components/TestResults';
import { useArtefactCollection } from '@/hooks/useArtefactCollection';
import {
  beginRun as beginRunLib,
  commitResult as commitResultLib,
  replacePayload,
  upsert,
} from '@/lib/artefactCollection';
import { credentialContentHash } from '@/lib/credentialCollection';
import { newId } from '@/lib/id';
import { validateContext } from '@/lib/contextValidation';
import {
  detectExtension,
  SchemaFetchError,
  SchemaSelectionError,
  validateCredentialSchema,
  validateExtension,
} from '@/lib/schemaValidation';
import { detectVcdmVersion } from '@/lib/utils';
import { validateVcdmRules } from '@/lib/vcdm-validation';
import { verifyCredential } from '@/lib/verificationService';
import { decryptCredential as decryptCredentialLib } from '@/lib/decryptCredential';
import { credentialGroupType as realCredentialGroupType } from '@/lib/credentialCollection';

// utils is automocked in this suite; the harness's admission mirror needs the real gate.
const { isPermittedCredentialType: realIsPermittedCredentialType } = jest.requireActual('@/lib/utils');
import {
  decodeEnvelopedCredential as realDecodeEnvelopedCredential,
  isEnvelopedProof as realIsEnvelopedProof,
} from '@/lib/credentialService';
import { TestCaseStatus, TestCaseStepId } from '../../constants';
import type { StoredCredential, TestStep } from '@/types';
import type { CollectionState } from '@/types/artefact';
import confetti from 'canvas-confetti';
import { VCDM_CONTEXT_URLS, VCDMVersion } from '../../constants';

jest.mock('@/lib/verificationService');
jest.mock('@/lib/schemaValidation', () => ({
  ...jest.requireActual('@/lib/schemaValidation'),
  detectExtension: jest.fn(),
  validateCredentialSchema: jest.fn(),
  validateExtension: jest.fn(),
}));
jest.mock('@/lib/vcdm-validation');
jest.mock('@/lib/decryptCredential', () => ({
  ...jest.requireActual('@/lib/decryptCredential'),
  decryptCredential: jest.fn(),
}));
jest.mock('@/lib/utils');
jest.mock('@/lib/contextValidation');
jest.mock('canvas-confetti');
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

// Real detectCredentialType/isEnvelopedProof from '@/lib/credentialService' are left
// unmocked, so grouping by detected type (#810) exercises the real detection over realistic fixtures.

const untpContext = (version: string) => `https://vocabulary.uncefact.org/untp/dpp/${version}/context.jsonld`;

function makeStored(
  overrides: { id?: string; type?: string[]; version?: string; issuer?: any; context?: string[] } = {},
  source?: StoredCredential['source'],
): StoredCredential {
  const version = overrides.version ?? '0.6.0';
  return {
    original: { proof: { type: 'Ed25519Signature2020' } },
    decoded: {
      '@context': overrides.context ?? [VCDM_CONTEXT_URLS.v2, untpContext(version)],
      type: overrides.type ?? ['VerifiableCredential', 'DigitalProductPassport'],
      issuer: overrides.issuer ?? { id: 'did:web:acme.example' },
      ...(overrides.id !== undefined && { id: overrides.id }),
    },
    source,
  };
}

// Harness: drives the real collection hook so the pipeline runs and the cards re-render on commit.
function Harness({
  credentials,
  throwOnRunnerStart = false,
}: {
  credentials: StoredCredential[];
  throwOnRunnerStart?: boolean;
}) {
  const collection = useArtefactCollection<StoredCredential, TestStep[]>();
  const seeded = useRef(false);
  const runnerDispatchCalls = useRef(0);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    for (const c of credentials) {
      const { outcome } = collection.dispatch((state) =>
        upsert(state, { payload: c, contentHash: credentialContentHash(c.decoded), mintInstanceId: newId }),
      );
      // Mirror page.tsx ingestion (#813): locked instances arrive with their terminal WARNING
      // Decryption step already seeded.
      if (c.encryptedEnvelope) {
        const lockedSteps: TestStep[] = [
          { id: TestCaseStepId.DECRYPTION, name: 'Decryption', status: TestCaseStatus.WARNING } as TestStep,
        ];
        const { runId } = collection.dispatch((state) => beginRunLib(state, outcome.instanceId, lockedSteps, newId));
        if (runId) {
          collection.dispatch((state) =>
            commitResultLib(state, { instanceId: outcome.instanceId, runId, result: lockedSteps }),
          );
        }
      }
    }
  }, [credentials, collection]);
  // Mirror the page's decrypt admission (#813): shape gate, enveloped decode, permitted type,
  // then replace-in-place. Collision paths are unit-tested against the page itself.
  const handleDecrypted = (item: any, credential: unknown): boolean => {
    try {
      const normalized = (credential as any)?.verifiableCredential || credential;
      if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) return false;
      const decoded = realIsEnvelopedProof(normalized) ? realDecodeEnvelopedCredential(normalized) : normalized;
      const type = realCredentialGroupType(decoded);
      if (!type || !realIsPermittedCredentialType(type)) return false;
      const stored: StoredCredential = {
        original: normalized,
        decoded,
        source: item.payload.source,
        decryptedFromEnvelope: true,
      };
      collection.dispatch((state) =>
        replacePayload(state, item.instanceId, stored, credentialContentHash(stored.decoded)),
      );
      return true;
    } catch {
      return false;
    }
  };
  const runnerDispatch = <Res extends { state: CollectionState<StoredCredential, TestStep[]> }>(
    reducer: (state: CollectionState<StoredCredential, TestStep[]>) => Res,
  ): Res => {
    runnerDispatchCalls.current += 1;
    if (throwOnRunnerStart && runnerDispatchCalls.current === 2) throw new Error('late runner failure');
    return collection.dispatch(reducer);
  };

  return (
    <TestResults
      collection={collection.state}
      dispatch={throwOnRunnerStart ? runnerDispatch : collection.dispatch}
      onDecrypted={handleDecrypted}
    />
  );
}

function FocusHarness({ onConsumed }: { onConsumed: () => void }) {
  const collection = useArtefactCollection<StoredCredential, TestStep[]>();
  const [focusInstanceId, setFocusInstanceId] = useState<string>();
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const { outcome } = collection.dispatch((state) =>
      upsert(state, {
        payload: makeStored({ id: 'focus-target' }),
        contentHash: 'focus-target',
        mintInstanceId: () => 'focus-instance',
      }),
    );
    setFocusInstanceId(outcome.instanceId);
  }, [collection]);

  return (
    <TestResults
      collection={collection.state}
      dispatch={collection.dispatch}
      onDecrypted={() => true}
      focusInstanceId={focusInstanceId}
      onFocusInstanceConsumed={() => {
        onConsumed();
        setFocusInstanceId(undefined);
      }}
    />
  );
}

function RepeatFocusHarness() {
  const collection = useArtefactCollection<StoredCredential, TestStep[]>();
  const [focusInstanceId, setFocusInstanceId] = useState<string>();
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const { outcome } = collection.dispatch((state) =>
      upsert(state, {
        payload: makeStored({ id: 'repeat-focus-target' }),
        contentHash: 'repeat-focus-target',
        mintInstanceId: () => 'repeat-focus-instance',
      }),
    );
    setFocusInstanceId(outcome.instanceId);
  }, [collection]);

  return (
    <>
      <button type='button' data-testid='repeat-focus-clear' onClick={() => setFocusInstanceId(undefined)}>
        Clear focus
      </button>
      <button
        type='button'
        data-testid='repeat-focus-request'
        onClick={() => setFocusInstanceId('repeat-focus-instance')}
      >
        Focus again
      </button>
      <TestResults
        collection={collection.state}
        dispatch={collection.dispatch}
        onDecrypted={() => true}
        focusInstanceId={focusInstanceId}
      />
    </>
  );
}

function StaticResults({ step }: { step: TestStep }) {
  const collection: CollectionState<StoredCredential, TestStep[]> = {
    items: [
      {
        instanceId: 'static-instance',
        contentHash: 'static-content',
        payload: makeStored({ id: 'static-credential' }),
        runId: 'static-run',
        result: [step],
      },
    ],
  };

  return <TestResults collection={collection} dispatch={jest.fn() as any} onDecrypted={() => true} />;
}

const expandInstance = () => userEvent.click(screen.getByTestId('credential-instance-header'));

// The group rollup icon is shown only while the group is collapsed (expanded groups show each
// instance's own status), so a test that asserts the rollup collapses the group first.
const collapseGroup = async (type = 'DigitalProductPassport') =>
  userEvent.click(await screen.findByTestId(`${type}-group-header`));

// Harness for a replace-in-place sequence: seeds one credential on mount, then upserts a second
// credential (identical or distinct content, chosen by the caller) on a button click, exactly the
// way page.tsx's handleArtefactUpload dispatches each upload through the same collection.
function ReplaceHarness({ first, second }: { first: StoredCredential; second: StoredCredential }) {
  const collection = useArtefactCollection<StoredCredential, TestStep[]>();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    collection.dispatch((state) =>
      upsert(state, { payload: first, contentHash: credentialContentHash(first.decoded), mintInstanceId: newId }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadSecond = () => {
    collection.dispatch((state) =>
      upsert(state, { payload: second, contentHash: credentialContentHash(second.decoded), mintInstanceId: newId }),
    );
  };

  return (
    <>
      <button onClick={uploadSecond}>Upload second</button>
      <output data-testid='replacement-vcdm-failure'>
        {collection.state.items[0]?.result?.find((step) => step.id === TestCaseStepId.VCDM_SCHEMA_VALIDATION)
          ?.failure === undefined
          ? 'undefined'
          : 'present'}
      </output>
      <TestResults collection={collection.state} dispatch={collection.dispatch} />
    </>
  );
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
  (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
  (validateExtension as jest.Mock).mockResolvedValue({ valid: true });
  (validateVcdmRules as jest.Mock).mockResolvedValue({ valid: true });
  (validateContext as jest.Mock).mockResolvedValue({ valid: true, data: {} });
  (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.V2);
  (detectExtension as jest.Mock).mockReturnValue(undefined);
});

describe('TestResults grouping (#810, #845)', () => {
  it('expands and centres the requested credential card once', async () => {
    const scrollIntoView = jest.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const onConsumed = jest.fn();

    try {
      render(<FocusHarness onConsumed={onConsumed} />);

      await waitFor(() => expect(screen.getByTestId('credential-instance-body')).toBeInTheDocument());
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
      expect(onConsumed).toHaveBeenCalledTimes(1);
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      }
    }
  });

  it('does not scroll again when the same expanded credential is requested twice', async () => {
    const scrollIntoView = jest.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      render(<RepeatFocusHarness />);
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByTestId('repeat-focus-clear'));
      fireEvent.click(screen.getByTestId('repeat-focus-request'));

      await waitFor(() => expect(screen.getByTestId('credential-instance-body')).toBeInTheDocument());
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      }
    }
  });

  it.each([
    [
      'successful',
      {
        id: TestCaseStepId.UNTP_SCHEMA_VALIDATION,
        name: 'UNTP Schema Validation',
        status: TestCaseStatus.SUCCESS,
      },
      'UNTP Schema Validation',
    ],
    [
      'failed',
      {
        id: TestCaseStepId.UNTP_SCHEMA_VALIDATION,
        name: 'UNTP Schema Validation',
        status: TestCaseStatus.FAILURE,
        failure: {
          class: 'credential-invalid' as const,
          code: 'schema.validation.payload',
          message: 'The credential is invalid.',
          remediation: 'Correct the credential.',
        },
      },
      'UNTP Schema ValidationView Details',
    ],
    [
      'not-executed',
      {
        id: TestCaseStepId.UNTP_SCHEMA_VALIDATION,
        name: 'UNTP Schema Validation',
        status: TestCaseStatus.FAILURE,
        failure: {
          class: 'unknown' as const,
          code: 'playground.pipeline.not-executed',
          message: 'This step was not executed.',
          remediation: 'Review the first failed step.',
        },
      },
      'UNTP Schema ValidationView Details',
    ],
  ])('keeps the %s credential step row limited to its name and details action', async (_label, step, expectedText) => {
    render(<StaticResults step={step as TestStep} />);
    fireEvent.click(await screen.findByTestId('credential-instance-header'));

    expect((await screen.findByTestId(`${TestCaseStepId.UNTP_SCHEMA_VALIDATION}-row`)).textContent).toBe(expectedText);
  });

  it('renders a group only for a credential type that has an uploaded instance', async () => {
    render(<Harness credentials={[makeStored({ id: 'a' })]} />);

    expect(await screen.findByRole('heading', { level: 3, name: 'Digital Product Passport' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Digital Conformity Credential' })).not.toBeInTheDocument();
  });

  it('groups multiple instances of the same type under one header with an instance count', async () => {
    render(
      <Harness
        credentials={[
          makeStored({ id: 'a' }, { kind: 'file', filename: 'dpp-a.json' }),
          makeStored({ id: 'b' }, { kind: 'file', filename: 'dpp-b.json' }),
        ]}
      />,
    );

    expect(await screen.findByRole('heading', { level: 3, name: 'Digital Product Passports' })).toBeInTheDocument();
    expect(screen.getByTestId('DigitalProductPassport-group-header')).toHaveTextContent('2');
    expect(await screen.findByText('dpp-a.json')).toBeInTheDocument();
    expect(await screen.findByText('dpp-b.json')).toBeInTheDocument();
  });

  it('rolls the group status up to the worst instance: any failing instance fails the whole group', async () => {
    (validateCredentialSchema as jest.Mock).mockImplementation(async (decoded: any) => ({
      valid: decoded.id !== 'fail',
    }));

    render(
      <Harness
        credentials={[
          makeStored({ id: 'pass' }, { kind: 'file', filename: 'dpp-pass.json' }),
          makeStored({ id: 'fail' }, { kind: 'file', filename: 'dpp-fail.json' }),
        ]}
      />,
    );

    await screen.findByText('dpp-pass.json');
    await collapseGroup();
    await waitFor(() => {
      expect(screen.getByTestId('DigitalProductPassport-status-icon-failure')).toBeInTheDocument();
    });
  });

  it('shows a success rollup once every instance in the group has passed', async () => {
    render(
      <Harness
        credentials={[
          makeStored({ id: 'a' }, { kind: 'file', filename: 'dpp-a.json' }),
          makeStored({ id: 'b' }, { kind: 'file', filename: 'dpp-b.json' }),
        ]}
      />,
    );

    await collapseGroup();
    await waitFor(() => {
      expect(screen.getByTestId('DigitalProductPassport-status-icon-success')).toBeInTheDocument();
    });
  });
});

describe('TestResults removal (#810)', () => {
  it('removes an instance only after the confirmation dialog is confirmed, and the group disappears once its last instance is removed', async () => {
    render(<Harness credentials={[makeStored({ id: 'only' }, { kind: 'file', filename: 'dpp-only.json' })]} />);

    await screen.findByText('dpp-only.json');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove dpp-only.json' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remove dpp-only.json' }));
    expect(await screen.findByText('Remove dpp-only.json?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 3, name: 'Digital Product Passport' })).not.toBeInTheDocument();
    });
  });

  it('keeps the instance when the removal is cancelled', async () => {
    render(<Harness credentials={[makeStored({ id: 'keep' }, { kind: 'file', filename: 'dpp-keep.json' })]} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove dpp-keep.json' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remove dpp-keep.json' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('dpp-keep.json')).toBeInTheDocument();
  });

  it('does not offer a remove control while an instance is mid-pipeline', async () => {
    let resolveVerify: (value: { verified: boolean }) => void = () => {};
    (verifyCredential as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVerify = resolve;
        }),
    );

    render(<Harness credentials={[makeStored({ id: 'pending' }, { kind: 'file', filename: 'dpp-pending.json' })]} />);

    await screen.findByText('dpp-pending.json');
    expect(screen.queryByRole('button', { name: 'Remove dpp-pending.json' })).not.toBeInTheDocument();

    await act(async () => {
      resolveVerify({ verified: true });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove dpp-pending.json' })).toBeInTheDocument();
    });
  });

  it('keeps the remove control inside the expanded header row', async () => {
    render(
      <Harness credentials={[makeStored({ id: 'header-only' }, { kind: 'file', filename: 'dpp-header-only.json' })]} />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove dpp-header-only.json' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('credential-instance-header'));

    const header = screen.getByTestId('credential-instance-header');
    const body = screen.getByTestId('credential-instance-body');
    const removeButton = screen.getByRole('button', { name: 'Remove dpp-header-only.json' });
    expect(header.contains(removeButton)).toBe(true);
    expect(body.contains(removeButton)).toBe(false);
  });
});

describe('Credential verification throw regression (#810)', () => {
  it('settles every step when initial result construction throws', async () => {
    (detectVcdmVersion as jest.Mock).mockImplementationOnce(() => {
      throw new Error('detector failed');
    });
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'initialisation-throw' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('proof-type-status-icon-failure')).toBeInTheDocument();
      expect(screen.getByTestId('context-status-icon-failure')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('decryption-status-icon-failure')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/status-icon-(pending|in-progress)/)).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(
      'Validation could not start. Report the details to the Playground operator.',
    );
  });

  it('keeps decryption successful when an encrypted credential fails during initialisation', async () => {
    (detectVcdmVersion as jest.Mock).mockImplementationOnce(() => {
      throw new Error('detector failed');
    });
    const { toast } = require('sonner');
    const decrypted: StoredCredential = {
      ...makeStored({ id: 'encrypted-initialisation-throw' }),
      decryptedFromEnvelope: true,
    };

    render(<Harness credentials={[decrypted]} />);

    await waitFor(() => {
      expect(screen.getByTestId('decryption-status-icon-success')).toBeInTheDocument();
      expect(screen.getByTestId('proof-type-status-icon-failure')).toBeInTheDocument();
      expect(screen.getByTestId('context-status-icon-failure')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('decryption-status-icon-failure')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/status-icon-(pending|in-progress)/)).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'View Details' })).toHaveLength(6);
    expect(toast.error).toHaveBeenCalledWith(
      'Validation could not start. Report the details to the Playground operator.',
    );
  });

  it('settles the remaining steps when the runner fails before its inner step catches', async () => {
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'outer-catch' })]} throwOnRunnerStart />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('verification-status-icon-failure')).toBeInTheDocument();
      expect(screen.getByTestId('context-status-icon-failure')).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId(/status-icon-(pending|in-progress)/)).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(
      'Validation failed unexpectedly. Report the details to the Playground operator.',
    );
  });

  it('fails the verification step, settles every other step, and allows removal when verifyCredential throws', async () => {
    (verifyCredential as jest.Mock).mockRejectedValue(new Error('Service unavailable'));
    const { toast } = require('sonner');

    render(
      <Harness credentials={[makeStored({ id: 'verify-throw' }, { kind: 'file', filename: 'dpp-throw.json' })]} />,
    );
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('verification-status-icon-failure')).toBeInTheDocument();
    });

    // No step is left pending or in progress: a thrown verification error settles the whole
    // pipeline rather than leaving the instance stuck mid-run.
    await waitFor(() => {
      expect(screen.queryAllByTestId(/status-icon-(pending|in-progress)/)).toHaveLength(0);
    });

    // A settled pipeline (success or failure on every step) makes the instance removable.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove dpp-throw.json' })).toBeInTheDocument();
    });

    expect(toast.error).toHaveBeenCalledWith('Credential verification failed', {
      description: 'Could not reach the verification service. Please try again.',
    });
  });

  it('fails the context step, settles every other step, and allows removal when validateContext throws', async () => {
    (validateContext as jest.Mock).mockRejectedValue(new Error('jsonld expansion failed'));
    const { toast } = require('sonner');

    render(
      <Harness credentials={[makeStored({ id: 'context-throw' }, { kind: 'file', filename: 'dpp-context.json' })]} />,
    );
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('context-status-icon-failure')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId(/status-icon-(pending|in-progress)/)).toHaveLength(0);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove dpp-context.json' })).toBeInTheDocument();
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Validation failed unexpectedly. Report the details to the Playground operator.',
    );
  });
});

describe('Credential replace-in-place through the collection (#810)', () => {
  it('replaces the same content in place and reruns its pipeline for the replacement', async () => {
    const first = makeStored({ id: 'replace-me' }, { kind: 'file', filename: 'dpp-replace.json' });
    // Same decoded content as `first` (same id, type, issuer, context), so its content hash matches
    // and the upsert replaces the existing instance rather than appending a second one.
    const second = makeStored({ id: 'replace-me' }, { kind: 'file', filename: 'dpp-replace.json' });

    render(<ReplaceHarness first={first} second={second} />);

    await screen.findByText('dpp-replace.json');
    await waitFor(() => {
      expect(screen.getByTestId('DigitalProductPassport-group-header')).toHaveTextContent('1');
    });
    await waitFor(() => {
      expect(validateVcdmRules).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Upload second' }));

    // Still exactly one instance row for the group: the upload replaced rather than appended.
    await waitFor(() => {
      expect(screen.getByTestId('DigitalProductPassport-group-header')).toHaveTextContent('1');
    });
    expect(screen.getAllByTestId('credential-instance-header')).toHaveLength(1);

    // The pipeline reran for the replacement: the validators were invoked a second time and the
    // row reaches a settled status again rather than keeping the pre-replacement result.
    await waitFor(() => {
      expect(validateVcdmRules).toHaveBeenCalledTimes(2);
    });
    await collapseGroup();
    await waitFor(() => {
      expect(screen.getByTestId('DigitalProductPassport-status-icon-success')).toBeInTheDocument();
    });
  });

  it('clears stale failure metadata when a replacement succeeds', async () => {
    (validateVcdmRules as jest.Mock)
      .mockResolvedValueOnce({
        valid: false,
        errors: [],
        failure: {
          class: 'unknown',
          code: 'schema.validation.dialect',
          message: 'old schema diagnostic',
          remediation: 'Report these details to the Playground operator.',
        },
      })
      .mockResolvedValue({ valid: true, errors: [] });
    const first = makeStored({ id: 'failure-then-success' }, { kind: 'file', filename: 'dpp-retry.json' });
    const second = makeStored({ id: 'failure-then-success' }, { kind: 'file', filename: 'dpp-retry.json' });

    render(<ReplaceHarness first={first} second={second} />);
    await expandInstance();
    await waitFor(() => {
      expect(screen.getByTestId('vcdm-schema-validation-status-icon-failure')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Upload second' }));
    await waitFor(() => {
      expect(validateVcdmRules).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('vcdm-schema-validation-status-icon-success')).toBeInTheDocument();
    });
    expect(screen.getByTestId('replacement-vcdm-failure')).toHaveTextContent('undefined');
  });
});

describe('Credential validation pipeline (preserved verbatim from pre-#810)', () => {
  it('shows unsupported VCDM version as a failed step', async () => {
    (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.UNKNOWN);

    render(<Harness credentials={[makeStored({ id: 'unknown-vcdm' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('vcdm-version-status-icon-failure')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('vcdm-version-view-details'));
    expect(await screen.findByTestId('validation-issue-card')).toHaveTextContent(
      'The credential declares @context entries',
    );
  });

  it('states the missing context fact for an unsupported VCDM version', async () => {
    (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.UNKNOWN);

    render(<Harness credentials={[makeStored({ id: 'unknown-vcdm-no-context', context: [] })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('vcdm-version-status-icon-failure')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('vcdm-version-view-details'));
    expect(await screen.findByTestId('validation-issue-card')).toHaveTextContent(
      'The credential declares no @context entries, so no VCDM version can be detected.',
    );
  });

  it('shows success for valid VCDM schema validation', async () => {
    render(<Harness credentials={[makeStored({ id: 'vcdm-ok' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('vcdm-schema-validation-status-icon-success')).toBeInTheDocument();
    });
    expect(validateVcdmRules).toHaveBeenCalledWith(expect.objectContaining({ id: 'vcdm-ok' }));
  });

  it('shows failure for invalid VCDM schema validation', async () => {
    (validateVcdmRules as jest.Mock).mockResolvedValue({ valid: false, errors: [{ message: 'bad vcdm' }] });

    render(<Harness credentials={[makeStored({ id: 'vcdm-bad' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('vcdm-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
  });

  it('handles VCDM schema fetch errors', async () => {
    (validateVcdmRules as jest.Mock).mockRejectedValue(new Error('network down'));
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'vcdm-fetch-error' })]} />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Validation failed unexpectedly. Report the details to the Playground operator.',
      );
    });
    await expandInstance();
    await waitFor(() => {
      expect(screen.getByTestId('vcdm-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
  });

  it('reports a credential schema URL builder failure as a Playground fault', async () => {
    (validateCredentialSchema as jest.Mock).mockRejectedValue(
      new SchemaSelectionError('The Playground could not build a schema URL: invalid version.', 'builder'),
    );

    render(<Harness credentials={[makeStored({ id: 'untp-builder-error' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('untp-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('untp-schema-validation-view-details'));
    expect(await screen.findByTestId('validation-issue-card')).toHaveTextContent(
      'The Playground could not build a schema URL',
    );
    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
      'Report these details to the Playground operator.',
    );
    expect(screen.queryByText(/Use a Conformity Scheme published/)).not.toBeInTheDocument();
  });

  it('shows the UNTP schema fetch error with the exact preserved copy and params', async () => {
    (validateCredentialSchema as jest.Mock).mockRejectedValue(new Error('fetch failed'));
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'untp-fetch-error' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Validation failed unexpectedly. Report the details to the Playground operator.',
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('untp-schema-validation-status-icon-failure')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('untp-schema-validation-view-details'));
    expect(await screen.findByTestId('validation-issue-card')).toHaveTextContent(
      'The credential validation step failed unexpectedly: fetch failed',
    );
  });

  it('records schema selection failures without a retry toast, and still settles the later steps', async () => {
    (validateCredentialSchema as jest.Mock).mockRejectedValue(
      new SchemaSelectionError('Unsupported version', 'version-not-detected'),
    );
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'untp-selection-error' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('untp-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
    expect(toast.error).not.toHaveBeenCalled();

    // The selection branch must fall through to Context Validation. Returning early there leaves
    // the step non-terminal, which makes the instance non-removable and blocks report generation.
    await waitFor(() => {
      expect(screen.getByTestId('context-status-icon-success')).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId(/status-icon-(pending|in-progress)/)).toHaveLength(0);

    await userEvent.click(screen.getByTestId('untp-schema-validation-view-details'));
    expect(await screen.findByText(/Unsupported version/)).toBeInTheDocument();
  });

  // The ordinary journey behind the same branch: the page admits a permitted type whose @context
  // carries no UNTP version, and the real selection code rejects it before any schema transport.
  it('settles every step for an admitted credential whose @context carries no UNTP version', async () => {
    const { validateCredentialSchema: realValidateCredentialSchema } =
      jest.requireActual<typeof import('@/lib/schemaValidation')>('@/lib/schemaValidation');
    (validateCredentialSchema as jest.Mock).mockImplementation(realValidateCredentialSchema);
    const { toast } = require('sonner');
    const noUntpContext: StoredCredential = {
      original: { proof: { type: 'Ed25519Signature2020' } },
      decoded: {
        '@context': [VCDM_CONTEXT_URLS.v2],
        type: ['VerifiableCredential', 'DigitalProductPassport'],
        issuer: { id: 'did:web:acme.example' },
        id: 'no-untp-context',
      },
    };

    render(<Harness credentials={[noUntpContext]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('untp-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('context-status-icon-success')).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId(/status-icon-(pending|in-progress)/)).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('untp-schema-validation-view-details'));
    expect(await screen.findByText(/declares @context entries/)).toBeInTheDocument();
  });

  it('blames the schema host, not the credential, when the schema could not be fetched', async () => {
    (validateCredentialSchema as jest.Mock).mockRejectedValue(
      new SchemaFetchError({
        code: 'playground.schema.fetch',
        message: 'Schema host could not be reached.',
        schemaUrl: untpContext('0.6.0'),
        category: 'unreachable',
        serviceStatus: 502,
        reason: 'network',
      }),
    );
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'untp-host-down' })]} />);
    await expandInstance();

    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('untp-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('untp-schema-validation-view-details'));
    expect(await screen.findByTestId('validation-issue-card')).toHaveTextContent(
      'The Playground could not fetch the artefact',
    );
    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(/Retry the check/);
    expect(screen.queryByText(/required UNTP context IRIs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing in the credential/)).not.toBeInTheDocument();
  });

  it('keeps a foreign reason-shaped thrown value unknown rather than credential-invalid', async () => {
    (validateCredentialSchema as jest.Mock).mockRejectedValue({
      reason: 'unknown-type',
      message: 'foreign reason-shaped value',
    });

    render(<Harness credentials={[makeStored({ id: 'foreign-error' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('untp-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('untp-schema-validation-view-details'));
    expect(await screen.findByTestId('validation-issue-card')).toHaveTextContent(
      'The credential validation step failed unexpectedly: [object Object]',
    );
  });

  it('classifies a 403 schema response as not published for the declared version', async () => {
    (validateCredentialSchema as jest.Mock).mockRejectedValue(
      new SchemaFetchError({
        code: 'playground.schema.fetch',
        message: 'Schema host returned status 403.',
        schemaUrl: untpContext('0.6.0'),
        category: 'upstream-status',
        serviceStatus: 502,
        upstreamStatus: 403,
        reason: 'not-found',
      }),
    );

    render(<Harness credentials={[makeStored({ id: 'untp-schema-404' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('untp-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('untp-schema-validation-view-details'));
    const card = await screen.findByTestId('validation-issue-card');
    expect(card).toHaveTextContent('returned HTTP status 403');
    expect(card).toHaveTextContent(untpContext('0.6.0'));
    expect(card).toHaveTextContent('HTTP status 403');
    expect(card).toHaveTextContent('declared version 0.6.0');
    expect(card).toHaveTextContent('@context version 0.6.0');
  });

  it('blames the extension schema host, not the credential, when that schema could not be fetched', async () => {
    (detectExtension as jest.Mock).mockReturnValue({
      core: { type: 'DigitalProductPassport', version: '0.5.0' },
      extension: { type: 'DigitalLivestockPassport', version: '0.4.0' },
    });
    (validateExtension as jest.Mock).mockRejectedValue(
      new SchemaFetchError({
        code: 'playground.schema.fetch',
        message: 'The schema could not be loaded from its host.',
        schemaUrl:
          'https://aatp.foodagility.com/assets/files/aatp-dlp-schema-0.4.0-9c0ad2b1ca6a9e497dedcfd8b87f35f1.json',
        category: 'unreachable',
        serviceStatus: 502,
        reason: 'network',
      }),
    );
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'extension-host-down' })]} />);
    await expandInstance();

    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('extension-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
  });

  it('uses the context timeout copy in the issue card, not the raw abort error', async () => {
    (validateContext as jest.Mock).mockResolvedValue({
      valid: false,
      error: {
        keyword: 'jsonldService',
        message: "The Playground's context service did not respond within 15s. Retry in a moment.",
        instancePath: '',
      },
      failure: {
        class: 'could-not-fetch',
        code: 'context.service',
        message:
          "The Playground context service could not be reached: The Playground's context service did not respond within 15s. Retry in a moment.",
        remediation:
          'Retry the check. If it keeps failing, report the URL and these details to the Playground operator.',
      },
    });
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'context-fail' })]} />);
    await expandInstance();

    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('context-status-icon-failure')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('context-view-details'));
    const card = await screen.findByTestId('validation-issue-card');
    expect(card).toHaveTextContent('did not respond within 15s');
    expect(screen.queryByText('The user aborted a request.')).not.toBeInTheDocument();
  });

  it('opens View Details for a VCDM failure even when it has no Ajv errors', async () => {
    (validateVcdmRules as jest.Mock).mockResolvedValue({
      valid: false,
      errors: [],
      failure: {
        class: 'unknown',
        code: 'schema.validation.dialect',
        message: 'The VCDM schema declares draft-07.',
        remediation: 'Report these details to the Playground operator.',
      },
    });

    render(<Harness credentials={[makeStored({ id: 'vcdm-details' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('vcdm-schema-validation-status-icon-failure')).toBeInTheDocument();
      expect(screen.queryByTestId('vcdm-schema-validation-status-icon-success')).not.toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('vcdm-schema-validation-view-details'));
    expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(1);
    expect(screen.getAllByText('Report these details to the Playground operator.')).toHaveLength(1);
  });

  it('shows a verification failure toast with the underlying error description', async () => {
    (verifyCredential as jest.Mock).mockResolvedValue({ verified: false, error: 'signature mismatch' });
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'verify-fail' })]} />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Credential verification failed', {
        description: 'signature mismatch',
      });
    });
  });

  it('runs the extension schema validation step only when an extension is detected', async () => {
    (detectExtension as jest.Mock).mockReturnValue({
      core: { type: 'DigitalProductPassport', version: '0.5.0' },
      extension: { type: 'DigitalLivestockPassport', version: '0.4.0' },
    });

    render(<Harness credentials={[makeStored({ id: 'extension' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(screen.getByTestId('extension-schema-validation-status-icon-success')).toBeInTheDocument();
    });
  });

  it('handles unexpected extension schema errors with the operator report copy', async () => {
    (detectExtension as jest.Mock).mockReturnValue({
      core: { type: 'DigitalProductPassport', version: '0.5.0' },
      extension: { type: 'DigitalLivestockPassport', version: '0.4.0' },
    });
    (validateExtension as jest.Mock).mockRejectedValue(new Error('fetch failed'));
    const { toast } = require('sonner');

    render(<Harness credentials={[makeStored({ id: 'extension-fetch-error' })]} />);
    await expandInstance();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Validation failed unexpectedly. Report the details to the Playground operator.',
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('extension-schema-validation-status-icon-failure')).toBeInTheDocument();
    });
  });
});

describe('Confetti behaviour, gated per (instanceId, runId)', () => {
  it('shows confetti when all validations pass', async () => {
    render(<Harness credentials={[makeStored({ id: 'confetti-pass' })]} />);

    await waitFor(() => {
      expect(confetti).toHaveBeenCalledTimes(1);
      expect(confetti).toHaveBeenCalledWith(expect.objectContaining(confettiConfig));
    });
  });

  it('does not show confetti when VCDM validation fails', async () => {
    (validateVcdmRules as jest.Mock).mockResolvedValue({ valid: false });

    render(<Harness credentials={[makeStored({ id: 'confetti-vcdm-fail' })]} />);

    // Collapse the group so its rollup icon (a known testid) reflects the single instance's settled
    // worst status; the rollup shows only while collapsed.
    await collapseGroup();
    await waitFor(() => {
      expect(screen.getByTestId('DigitalProductPassport-status-icon-failure')).toBeInTheDocument();
    });
    expect(confetti).not.toHaveBeenCalled();
  });

  it('does not show confetti when schema validation fails', async () => {
    (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: false });

    render(<Harness credentials={[makeStored({ id: 'confetti-schema-fail' })]} />);

    await collapseGroup();
    await waitFor(() => {
      expect(screen.getByTestId('DigitalProductPassport-status-icon-failure')).toBeInTheDocument();
    });
    expect(confetti).not.toHaveBeenCalled();
  });

  it('does not show confetti when verification fails', async () => {
    (verifyCredential as jest.Mock).mockResolvedValue({ verified: false });

    render(<Harness credentials={[makeStored({ id: 'confetti-verify-fail' })]} />);

    await collapseGroup();
    await waitFor(() => {
      expect(screen.getByTestId('DigitalProductPassport-status-icon-failure')).toBeInTheDocument();
    });
    expect(confetti).not.toHaveBeenCalled();
  });
});

describe('Link-set provenance subtitle (#812)', () => {
  it('subtitles a running link-set-verified instance with its provenance, then reverts on settle', async () => {
    // Hold the pipeline open so the mid-run subtitle is observable, then release it.
    let releaseVerification: (value: { verified: boolean }) => void = () => {};
    (verifyCredential as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        releaseVerification = resolve;
      }),
    );

    render(
      <Harness
        credentials={[
          makeStored({ id: 'a' }, { kind: 'url', url: 'https://x.example.org/creds/dpp.json', via: 'link-set' }),
        ]}
      />,
    );

    expect(await screen.findByText('Verifying... · from link set')).toBeInTheDocument();

    await act(async () => {
      releaseVerification({ verified: true });
    });

    await waitFor(() => {
      expect(screen.queryByText('Verifying... · from link set')).not.toBeInTheDocument();
    });
    // Settled: the normal subtitle (host · version · issuer) takes over.
    expect(screen.getByText(/x\.example\.org/)).toBeInTheDocument();
  });

  it('never shows the provenance subtitle for a plain URL upload', async () => {
    render(<Harness credentials={[makeStored({ id: 'a' }, { kind: 'url', url: 'https://x.example.org/c.json' })]} />);

    // Anchor on the rendered instance first; an immediate absence check could pass before the
    // card exists at all (panel finding).
    expect(await screen.findByText(/x\.example\.org/)).toBeInTheDocument();
    expect(screen.queryByText('Verifying... · from link set')).not.toBeInTheDocument();
  });
});

describe('Locked encrypted instances (#813)', () => {
  const envelope = {
    cipherText: 'SGVsbG8=',
    iv: 'nLUYsnXBY8bbXY45',
    tag: '7j0RRSoEIm2FAo52m1pyow==',
    type: 'aes-256-gcm',
  };
  const lockedStored = (source?: StoredCredential['source']): StoredCredential => ({
    original: envelope as any,
    decoded: envelope as any,
    source,
    encryptedEnvelope: true,
  });

  it('lists a locked instance under the Encrypted group with the amber tag, no pipeline, and removability', async () => {
    render(<Harness credentials={[lockedStored({ kind: 'file', filename: 'enc.json' })]} />);

    expect(await screen.findByRole('heading', { level: 3, name: 'Encrypted credential' })).toBeInTheDocument();
    expect(screen.getByTestId('credential-encrypted-tag')).toHaveTextContent('Encrypted');
    // No validation pipeline ran for the locked instance.
    expect(verifyCredential).not.toHaveBeenCalled();
    // Terminal synthetic step keeps it removable.
    fireEvent.click(screen.getByTestId('credential-instance-header'));
    expect(screen.getByTestId('decrypt-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove Encrypted credential/ })).toBeInTheDocument();
  });

  it('unlocks on decrypt: pipeline runs over the decrypted document with a leading successful Decryption step', async () => {
    (decryptCredentialLib as jest.Mock).mockResolvedValue({
      ok: true,
      credential: {
        '@context': [VCDM_CONTEXT_URLS.v2, 'https://vocabulary.uncefact.org/untp/dpp/0.6.0/context.jsonld'],
        type: ['VerifiableCredential', 'DigitalProductPassport'],
        issuer: { id: 'did:web:acme.example' },
        id: 'urn:decrypted:1',
      },
    });
    render(<Harness credentials={[lockedStored({ kind: 'url', url: 'https://x.example.org/enc.json' })]} />);

    fireEvent.click(await screen.findByTestId('credential-instance-header'));
    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'a'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));

    // The locked group dissolves into the real type group and the pipeline runs. The row mounts
    // EXPANDED (no second click: the decrypt panel is visually replaced by the card body), with
    // the Decryption step leading the list.
    expect(await screen.findByRole('heading', { level: 3, name: 'Digital Product Passport' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Encrypted credential' })).not.toBeInTheDocument();
    expect(await screen.findByText('Decryption')).toBeInTheDocument();
    const stepLabels = screen.getAllByText(/Decryption|Proof Type Detection/).map((el) => el.textContent);
    expect(stepLabels[0]).toBe('Decryption');
    await waitFor(() => {
      expect(verifyCredential).toHaveBeenCalled();
    });
  });

  it('runs no Decryption step for an ordinary unencrypted credential', async () => {
    render(<Harness credentials={[makeStored({ id: 'plain' }, { kind: 'file', filename: 'plain.json' })]} />);

    fireEvent.click(await screen.findByTestId('credential-instance-header'));
    await waitFor(() => {
      expect(screen.getByText('Proof Type Detection')).toBeInTheDocument();
    });
    expect(screen.queryByText('Decryption')).not.toBeInTheDocument();
  });
});

describe('Locked instances: review-finding hardening (#813)', () => {
  const envelope = {
    cipherText: 'SGVsbG8=',
    iv: 'nLUYsnXBY8bbXY45',
    tag: '7j0RRSoEIm2FAo52m1pyow==',
    type: 'aes-256-gcm',
  };
  const lockedStored = (name: string): StoredCredential => ({
    original: { ...envelope, marker: name } as any,
    decoded: { ...envelope, marker: name } as any,
    source: { kind: 'file', filename: name },
    encryptedEnvelope: true,
  });

  it('pluralises the locked group and shows the amber tag as its collapsed rollup', async () => {
    render(<Harness credentials={[lockedStored('one.json'), lockedStored('two.json')]} />);

    expect(await screen.findByRole('heading', { level: 3, name: 'Encrypted credentials' })).toBeInTheDocument();
    // Collapse the group: the rollup slot shows the amber tag, never a pass icon.
    fireEvent.click(screen.getByTestId('Encrypted-group-header'));
    expect(await screen.findByTestId('encrypted-group-tag')).toHaveTextContent('Encrypted');
    expect(screen.queryByTestId('status-icon-success-Encrypted')).not.toBeInTheDocument();
  });

  it('unlocks an envelope whose plaintext is itself an enveloped credential via the real decode path', async () => {
    // This suite deliberately keeps credentialService unmocked, so build a REAL enveloped form:
    // decodeEnvelopedCredential jwt-decodes the data: URL's payload.
    const inner = {
      '@context': [VCDM_CONTEXT_URLS.v2, 'https://vocabulary.uncefact.org/untp/dpp/0.6.0/context.jsonld'],
      type: ['VerifiableCredential', 'DigitalProductPassport'],
      issuer: { id: 'did:web:acme.example' },
      id: 'urn:inner:1',
    };
    const b64u = (value: string) => Buffer.from(value).toString('base64url');
    const jwt = `${b64u('{"alg":"none"}')}.${b64u(JSON.stringify(inner))}.`;
    const enveloped = { type: 'EnvelopedVerifiableCredential', id: `data:application/vc+jwt,${jwt}` };
    (decryptCredentialLib as jest.Mock).mockResolvedValue({ ok: true, credential: enveloped });

    render(<Harness credentials={[lockedStored('env.json')]} />);
    fireEvent.click(await screen.findByTestId('credential-instance-header'));
    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'a'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));

    expect(await screen.findByRole('heading', { level: 3, name: 'Digital Product Passport' })).toBeInTheDocument();
  });

  it('keeps the lock and shows a message when the decrypted content is not credential-shaped', async () => {
    (decryptCredentialLib as jest.Mock).mockResolvedValue({ ok: true, credential: 'a bare string' });
    render(<Harness credentials={[lockedStored('junk.json')]} />);

    fireEvent.click(await screen.findByTestId('credential-instance-header'));
    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'a'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));

    expect(await screen.findByTestId('decrypt-error')).toHaveTextContent(
      'Decryption succeeded, but the content is not a credential this Playground can validate',
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Encrypted credential' })).toBeInTheDocument();
  });
});
