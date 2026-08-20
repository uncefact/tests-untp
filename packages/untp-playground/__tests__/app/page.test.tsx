import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import {
  decodeEnvelopedCredential,
  isEnvelopedProof,
  detectCredentialType,
  detectVersion,
  detectArtefact,
} from '@/lib/credentialService';
import { detectExtension, validateCredentialSchema } from '@/lib/schemaValidation';
import { ArtefactUploader } from '@/components/ArtefactUploader';
import { SchemeTestResults } from '@/components/SchemeTestResults';
import { TestResults } from '@/components/TestResults';
import { beginRun, commitResult, remove } from '@/lib/artefactCollection';
import Home from '@/app/page';
import { mockCredential } from '../mocks/vc';
import { ArtefactKind, permittedCredentialTypes, TestCaseStatus } from '../../constants';

// Mock the dependencies
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/lib/credentialService', () => ({
  isEnvelopedProof: jest.fn(),
  decodeEnvelopedCredential: jest.fn(),
  detectArtefact: jest.fn(),
  detectCredentialType: jest.fn(),
  detectVersion: jest.fn(),
}));

jest.mock('@/lib/schemaValidation', () => ({
  detectExtension: jest.fn(),
  validateCredentialSchema: jest.fn(),
}));

const mockDispatchError = jest.fn();

jest.mock('@/contexts/ErrorContext', () => ({
  useError: jest.fn(() => ({
    dispatchError: mockDispatchError,
  })),
}));

// Mock child components
jest.mock('@/components/Header', () => ({
  Header: () => <div data-testid='mock-header'>Header</div>,
}));

jest.mock('@/components/Footer', () => ({
  Footer: () => <div data-testid='mock-footer'>Footer</div>,
}));

jest.mock('@/components/TestResults', () => ({
  TestResults: jest.fn(() => <div data-testid='mock-test-results'>Test Results</div>),
}));

jest.mock('@/components/SchemeTestResults', () => ({
  SchemeTestResults: jest.fn(() => <div data-testid='mock-scheme-test-results'>Scheme Test Results</div>),
}));

jest.mock('@/components/ArtefactUploader', () => ({
  ArtefactUploader: jest.fn(({ onArtefactUpload }: { onArtefactUpload: (credential: any) => void }) => (
    <button
      data-testid='mock-uploader'
      onClick={() =>
        onArtefactUpload({
          verifiableCredential: {
            type: ['VerifiableCredential', 'DigitalProductPassport'],
          },
        })
      }
    >
      Upload
    </button>
  )),
}));

jest.mock('@/components/DownloadCredential', () => ({
  DownloadCredential: () => <div data-testid='mock-download'>Download</div>,
}));

jest.mock('@/components/GenerateReportDialog', () => ({
  GenerateReportDialog: () => <div data-testid='mock-generate-report'>Generate Report</div>,
}));

jest.mock('@/components/DownloadReport', () => ({
  DownloadReport: () => <div data-testid='mock-download-report'>Download Report</div>,
}));

describe('Home Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all components correctly', () => {
    render(<Home />);

    expect(screen.getByTestId('mock-header')).toBeInTheDocument();
    expect(screen.getByTestId('mock-footer')).toBeInTheDocument();
    // Credentials start empty, so the placeholder shows in place of the results.
    expect(screen.getByText('No credentials yet')).toBeInTheDocument();
    expect(screen.getByTestId('mock-uploader')).toBeInTheDocument();
    expect(screen.getByTestId('mock-download')).toBeInTheDocument();
  });

  it('handles valid credential upload', async () => {
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectVersion as jest.Mock).mockReturnValue('0.5.0');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (validateCredentialSchema as jest.Mock).mockReturnValue({ valid: true });

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  it('handles invalid credential format', async () => {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (credential: any) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onArtefactUpload([])}>
          Upload
        </button>
      ),
    );

    const expectedValue = {
      keyword: 'type',
      instancePath: 'array',
      params: {
        type: 'object',
        receivedValue: [],
        solution: 'Instead of [credential1, credential2], upload credential1.json and credential2.json.',
      },
      message: 'Credentials must be uploaded as separate files, not as an array.',
    };

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(mockDispatchError).toHaveBeenCalledWith([expectedValue]);
    });
  });

  it('handles unknown credential type', async () => {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (credential: { verifiableCredential: any }) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onArtefactUpload(mockCredential)}>
          Upload
        </button>
      ),
    );

    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (detectCredentialType as jest.Mock).mockReturnValue('Unknown');
    (detectVersion as jest.Mock).mockReturnValue('0.1.0');

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(mockDispatchError).toHaveBeenCalledWith([
        {
          keyword: 'required',
          instancePath: '/type',
          params: {
            missingProperty: `type array with a supported types:  ${permittedCredentialTypes.join(', ')}`,
            receivedValue: mockCredential.verifiableCredential,
            allowedValue: { type: ['VerifiableCredential', 'DigitalProductPassport'] },
            solution: "Add a valid UNTP credential type (e.g., 'DigitalProductPassport', 'ConformityCredential').",
          },
          message: `The credential type is missing or invalid.`,
        },
      ]);
    });
  });

  it('handles enveloped credential correctly', async () => {
    const mockEnvelopedCredential = {
      type: ['VerifiableCredential', 'DigitalProductPassport'],
    };

    (isEnvelopedProof as jest.Mock).mockReturnValue(true);
    (decodeEnvelopedCredential as jest.Mock).mockReturnValue(mockEnvelopedCredential);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectVersion as jest.Mock).mockReturnValue('0.5.0');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (validateCredentialSchema as jest.Mock).mockReturnValue({ valid: true });

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(decodeEnvelopedCredential).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  it('handles error decoding credential', async () => {
    (isEnvelopedProof as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Error decoding credential');
    });

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to process artefact');
    });
  });
});

describe('Tabbed artefact surface (#809)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks resets calls but not implementations, so an override installed by any earlier
    // test would otherwise leak into the next one. Reinstall the defaults to keep every test
    // order-independent.
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any) => void }) => (
        <button
          data-testid='mock-uploader'
          onClick={() =>
            onArtefactUpload({ verifiableCredential: { type: ['VerifiableCredential', 'DigitalProductPassport'] } })
          }
        >
          Upload
        </button>
      ),
    );
    (TestResults as jest.Mock).mockImplementation(() => <div data-testid='mock-test-results'>Test Results</div>);
    (SchemeTestResults as jest.Mock).mockImplementation(() => (
      <div data-testid='mock-scheme-test-results'>Scheme Test Results</div>
    ));
  });

  // Shared ArtefactUploader stand-in for the scheme tab-meta tests below: uploading always
  // produces a single ConformityScheme instance, which each test then drives to a result via its
  // own SchemeTestResults mock.
  function mockSchemeArtefactUploader() {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any) => void }) => (
        <button
          data-testid='mock-uploader'
          onClick={() => onArtefactUpload({ verifiableCredential: { type: ['ConformityScheme'] } })}
        >
          Upload
        </button>
      ),
    );
  }

  it('renders a tab for each artefact family', () => {
    render(<Home />);

    expect(screen.getByRole('tab', { name: /Credentials/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Conformity Schemes/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Link Sets/ })).toBeInTheDocument();
  });

  it('renders the Test artefacts page header above the tab bar', () => {
    render(<Home />);

    const heading = screen.getByRole('heading', { name: 'Test artefacts' });
    const tablist = screen.getByRole('tablist');
    // The header sits above the tab bar. This checks the tablist follows the heading in document order.
    expect(heading.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the report actions once, above the tab bar (shared across families)', () => {
    render(<Home />);

    expect(screen.getAllByTestId('mock-generate-report')).toHaveLength(1);
    expect(screen.getAllByTestId('mock-download-report')).toHaveLength(1);

    const action = screen.getByTestId('mock-generate-report');
    const tablist = screen.getByRole('tablist');
    expect(action.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no instance counter on any tab while empty', () => {
    render(<Home />);

    // Exact-name matches: a stray "0" badge would change the accessible name and fail these.
    expect(screen.getByRole('tab', { name: 'Credentials' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Conformity Schemes' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Link Sets' })).toBeInTheDocument();
  });

  it('mounts all three family panels so validation is not tied to the active tab', () => {
    render(<Home />);

    // Force-mounted panels: every family's content is in the DOM regardless of the active tab,
    // so a family keeps validating even when its tab is not selected.
    expect(screen.getByText('No credentials yet')).toBeInTheDocument();
    expect(screen.getByText('No conformity schemes yet')).toBeInTheDocument();
    expect(screen.getByText('No link sets yet')).toBeInTheDocument();
  });

  it('renders a single shared uploader, not one per tab', () => {
    render(<Home />);

    // One hoisted sidebar; force-mounting the panels must not multiply the uploader.
    expect(screen.getAllByTestId('mock-uploader')).toHaveLength(1);
  });

  it('replaces a family empty state with its results once an artefact loads', async () => {
    (detectArtefact as jest.Mock).mockReturnValue({ kind: ArtefactKind.SCHEME, type: 'ConformityScheme' });
    render(<Home />);

    expect(screen.getByText('No conformity schemes yet')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-uploader'));

    await waitFor(() => {
      expect(screen.queryByText('No conformity schemes yet')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('mock-scheme-test-results')).toBeInTheDocument();
  });

  it('loads two distinct schemes as separate instances instead of overwriting', async () => {
    (detectArtefact as jest.Mock).mockReturnValue({ kind: ArtefactKind.SCHEME, type: 'ConformityScheme' });
    // Identity is the content hash, so each upload must carry distinct content to be a new instance.
    let marker = 0;
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any) => void }) => (
        <button
          data-testid='mock-uploader'
          onClick={() => onArtefactUpload({ verifiableCredential: { type: ['ConformityScheme'], marker: marker++ } })}
        >
          Upload
        </button>
      ),
    );
    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);
    fireEvent.click(uploader);

    // The Conformity Schemes tab count reflects the number of loaded instances, not a single slot.
    expect(await screen.findByRole('tab', { name: /Conformity Schemes\s*2/ })).toBeInTheDocument();
  });

  it('replaces in place when the same scheme content is uploaded twice', async () => {
    (detectArtefact as jest.Mock).mockReturnValue({ kind: ArtefactKind.SCHEME, type: 'ConformityScheme' });
    // Identical content each click -> same content hash -> the second upload replaces the first.
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any) => void }) => (
        <button
          data-testid='mock-uploader'
          onClick={() => onArtefactUpload({ verifiableCredential: { type: ['ConformityScheme'] } })}
        >
          Upload
        </button>
      ),
    );
    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);
    fireEvent.click(uploader);

    expect(await screen.findByRole('tab', { name: /Conformity Schemes\s*1/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Replaced'));
    });
    expect(toast.error).not.toHaveBeenCalledWith('Failed to process artefact');
  });

  it('loads two distinct credentials as separate instances instead of overwriting (#810)', async () => {
    // detectArtefact is left unset here (undefined => not a scheme), but earlier tests in this
    // block set it to the SCHEME kind and jest.clearAllMocks() does not reset a mockReturnValue,
    // so it is reset explicitly to route this upload to the credential branch.
    (detectArtefact as jest.Mock).mockReturnValue(undefined);
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (detectVersion as jest.Mock).mockReturnValue('0.6.0');
    (validateCredentialSchema as jest.Mock).mockReturnValue({ valid: true });

    // Identity is the content hash, so each upload must carry distinct content to be a new instance.
    let marker = 0;
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any) => void }) => (
        <button
          data-testid='mock-uploader'
          onClick={() =>
            onArtefactUpload({
              verifiableCredential: { type: ['VerifiableCredential', 'DigitalProductPassport'], marker: marker++ },
            })
          }
        >
          Upload
        </button>
      ),
    );
    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);
    fireEvent.click(uploader);

    // The Credentials tab count reflects the number of loaded instances, matching the Conformity
    // Schemes tab (#845).
    expect(await screen.findByRole('tab', { name: /Credentials(\s*verifying)?\s*2/ })).toBeInTheDocument();
  });

  it('replaces in place when the same credential content is uploaded twice (#810)', async () => {
    (detectArtefact as jest.Mock).mockReturnValue(undefined);
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (detectVersion as jest.Mock).mockReturnValue('0.6.0');
    (validateCredentialSchema as jest.Mock).mockReturnValue({ valid: true });

    // Identical content each click -> same content hash -> the second upload replaces the first.
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any) => void }) => (
        <button
          data-testid='mock-uploader'
          onClick={() =>
            onArtefactUpload({
              verifiableCredential: { type: ['VerifiableCredential', 'DigitalProductPassport'] },
            })
          }
        >
          Upload
        </button>
      ),
    );
    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);
    fireEvent.click(uploader);

    expect(await screen.findByRole('tab', { name: /Credentials(\s*verifying)?\s*1/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Replaced'));
    });
    expect(toast.error).not.toHaveBeenCalledWith('Failed to process artefact');
  });

  it('collapses two differently-enveloped credentials into one instance when their decoded content is identical (#810)', async () => {
    // Identity keys on `credentialContentHash(stored.decoded)`, the decoded document, never the
    // enveloping JWT (ADR-041). The mocked decoder always resolves to the same document below, so
    // two uploads with distinct envelopes must still collapse to one instance.
    const decodedCredential = { type: ['VerifiableCredential', 'DigitalProductPassport'], id: 'shared-content' };

    (detectArtefact as jest.Mock).mockReturnValue(undefined);
    (isEnvelopedProof as jest.Mock).mockReturnValue(true);
    (decodeEnvelopedCredential as jest.Mock).mockReturnValue(decodedCredential);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (detectVersion as jest.Mock).mockReturnValue('0.6.0');
    (validateCredentialSchema as jest.Mock).mockReturnValue({ valid: true });

    // Two distinct envelope shapes, so the pre-decode raw artefact differs on each upload; only the
    // decoded document (mocked to be identical every time) should determine identity.
    let envelopeMarker = 0;
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any) => void }) => (
        <button
          data-testid='mock-uploader'
          onClick={() => onArtefactUpload({ verifiableCredential: { envelope: `jwt-${envelopeMarker++}` } })}
        >
          Upload
        </button>
      ),
    );
    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);
    fireEvent.click(uploader);

    // One instance, and the second upload was a replace rather than an append.
    expect(await screen.findByRole('tab', { name: /Credentials(\s*verifying)?\s*1/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Replaced'));
    });
  });

  it('shows the credentials empty state when no credential is loaded', () => {
    render(<Home />);

    expect(screen.getByText('No credentials yet')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-test-results')).not.toBeInTheDocument();
  });

  it('shows the schemes empty state on the Conformity Schemes tab', async () => {
    render(<Home />);

    await userEvent.click(screen.getByRole('tab', { name: /Conformity Schemes/ }));

    expect(screen.getByText('No conformity schemes yet')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-scheme-test-results')).not.toBeInTheDocument();
  });

  it('shows the link sets empty state on the Link Sets tab', async () => {
    render(<Home />);

    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));

    expect(screen.getByText('No link sets yet')).toBeInTheDocument();
  });

  it('shows a red failing dot on the Conformity Schemes tab when one of several schemes fails, without switching tabs', async () => {
    (detectArtefact as jest.Mock).mockReturnValue({ kind: ArtefactKind.SCHEME, type: 'ConformityScheme' });
    // Two distinct schemes, so the dot must fire on "any instance failing", not "all failing".
    let marker = 0;
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any) => void }) => (
        <button
          data-testid='mock-uploader'
          onClick={() => onArtefactUpload({ verifiableCredential: { type: ['ConformityScheme'], marker: marker++ } })}
        >
          Upload
        </button>
      ),
    );
    // The mocked results panel settles the first scheme as passing and the second as failing,
    // exercising the same collection dispatch path the real pipeline uses.
    (SchemeTestResults as jest.Mock).mockImplementation(({ collection, dispatch }: any) => (
      <button
        data-testid='mock-scheme-fail'
        onClick={() => {
          collection.items.forEach((item: any, index: number) => {
            const { runId } = dispatch((state: any) => beginRun(state, item.instanceId, [], () => `run-${index}`));
            dispatch((state: any) =>
              commitResult(state, {
                instanceId: item.instanceId,
                runId,
                result: [
                  {
                    id: 'schema-validation',
                    name: 'Schema Validation',
                    status: index === 0 ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
                  },
                ],
              }),
            );
          });
        }}
      >
        Fail scheme
      </button>
    ));

    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-uploader'));
    fireEvent.click(screen.getByTestId('mock-uploader'));

    expect(screen.queryByTestId('schemes-tab-failing-dot')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('mock-scheme-fail'));

    // The default tab (Credentials) is still active; the failing dot must be visible cross-tab.
    expect(screen.getByRole('tab', { name: /Credentials/ })).toHaveAttribute('data-state', 'active');
    expect(await screen.findByTestId('schemes-tab-failing-dot')).toBeInTheDocument();
    // The dot itself is aria-hidden; the state must still reach assistive tech as text.
    expect(screen.getByText('failing')).toBeInTheDocument();
  });

  it('does not show a failing dot for a warning-only scheme instance', async () => {
    (detectArtefact as jest.Mock).mockReturnValue({ kind: ArtefactKind.SCHEME, type: 'ConformityScheme' });
    mockSchemeArtefactUploader();
    (SchemeTestResults as jest.Mock).mockImplementation(({ collection, dispatch }: any) => (
      <button
        data-testid='mock-scheme-warn'
        onClick={() => {
          const item = collection.items[0];
          const { runId } = dispatch((state: any) => beginRun(state, item.instanceId, [], () => 'run-warn'));
          dispatch((state: any) =>
            commitResult(state, {
              instanceId: item.instanceId,
              runId,
              result: [{ id: 'schema-validation', name: 'Schema Validation', status: TestCaseStatus.WARNING }],
            }),
          );
        }}
      >
        Warn scheme
      </button>
    ));

    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-uploader'));
    fireEvent.click(await screen.findByTestId('mock-scheme-warn'));

    // WARNING settles an instance without failing it: the count shows, no dot.
    expect(await screen.findByRole('tab', { name: /Conformity Schemes\s*1/ })).toBeInTheDocument();
    expect(screen.queryByTestId('schemes-tab-failing-dot')).not.toBeInTheDocument();
  });

  it('clears the schemes tab meta entirely when the last instance is removed', async () => {
    (detectArtefact as jest.Mock).mockReturnValue({ kind: ArtefactKind.SCHEME, type: 'ConformityScheme' });
    mockSchemeArtefactUploader();
    (SchemeTestResults as jest.Mock).mockImplementation(({ collection, dispatch }: any) => (
      <div>
        <button
          data-testid='mock-scheme-fail'
          onClick={() => {
            const item = collection.items[0];
            const { runId } = dispatch((state: any) => beginRun(state, item.instanceId, [], () => 'run-fail'));
            dispatch((state: any) =>
              commitResult(state, {
                instanceId: item.instanceId,
                runId,
                result: [{ id: 'schema-validation', name: 'Schema Validation', status: TestCaseStatus.FAILURE }],
              }),
            );
          }}
        >
          Fail scheme
        </button>
        <button
          data-testid='mock-scheme-remove'
          onClick={() => {
            const item = collection.items[0];
            dispatch((state: any) => remove(state, item.instanceId));
          }}
        >
          Remove scheme
        </button>
      </div>
    ));

    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-uploader'));
    fireEvent.click(await screen.findByTestId('mock-scheme-fail'));
    expect(await screen.findByTestId('schemes-tab-failing-dot')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-scheme-remove'));

    // No lingering count or failing dot once the family is empty again.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Conformity Schemes' })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('schemes-tab-failing-dot')).not.toBeInTheDocument();
  });

  it('shows a spinner on the Credentials tab while a credential verifies, and clears it when the run settles', async () => {
    (detectArtefact as jest.Mock).mockReturnValue(undefined);
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (detectVersion as jest.Mock).mockReturnValue('0.6.0');
    // Two distinct credentials, settled one at a time: the spinner must persist while any
    // instance is non-terminal, and clear only when the last one settles.
    let marker = 0;
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any) => void }) => (
        <button
          data-testid='mock-uploader'
          onClick={() =>
            onArtefactUpload({
              verifiableCredential: { type: ['VerifiableCredential', 'DigitalProductPassport'], marker: marker++ },
            })
          }
        >
          Upload
        </button>
      ),
    );
    // The mocked results panel settles one still-unsettled instance per click, all-success.
    (TestResults as jest.Mock).mockImplementation(({ collection, dispatch }: any) => (
      <button
        data-testid='mock-credential-settle'
        onClick={() => {
          const item = collection.items.find((candidate: any) => candidate.result === undefined);
          const { runId } = dispatch((state: any) =>
            beginRun(state, item.instanceId, [], () => `run-${item.instanceId}`),
          );
          dispatch((state: any) =>
            commitResult(state, {
              instanceId: item.instanceId,
              runId,
              result: [{ id: 'verification', name: 'Credential Verification', status: TestCaseStatus.SUCCESS }],
            }),
          );
        }}
      >
        Settle
      </button>
    ));

    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-uploader'));
    fireEvent.click(screen.getByTestId('mock-uploader'));

    // Fresh instances have no result yet, so the family counts as verifying immediately.
    expect(await screen.findByTestId('credentials-tab-verifying')).toBeInTheDocument();
    // The spinner itself is aria-hidden; the state must still reach assistive tech as text.
    expect(screen.getByText('verifying')).toBeInTheDocument();

    // Settling one of the two instances must not clear the spinner: the other is still verifying.
    fireEvent.click(screen.getByTestId('mock-credential-settle'));
    expect(await screen.findByTestId('credentials-tab-verifying')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-credential-settle'));

    await waitFor(() => {
      expect(screen.queryByTestId('credentials-tab-verifying')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('credentials-tab-failing-dot')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Credentials\s*2/ })).toBeInTheDocument();
  });

  it('shows a red failing dot on the Credentials tab when a credential instance fails', async () => {
    (detectArtefact as jest.Mock).mockReturnValue(undefined);
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (detectVersion as jest.Mock).mockReturnValue('0.6.0');
    (TestResults as jest.Mock).mockImplementation(({ collection, dispatch }: any) => (
      <button
        data-testid='mock-credential-fail'
        onClick={() => {
          const item = collection.items[0];
          const { runId } = dispatch((state: any) => beginRun(state, item.instanceId, [], () => 'run-fail'));
          dispatch((state: any) =>
            commitResult(state, {
              instanceId: item.instanceId,
              runId,
              result: [{ id: 'verification', name: 'Credential Verification', status: TestCaseStatus.FAILURE }],
            }),
          );
        }}
      >
        Fail credential
      </button>
    ));

    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-uploader'));
    fireEvent.click(await screen.findByTestId('mock-credential-fail'));

    expect(await screen.findByTestId('credentials-tab-failing-dot')).toBeInTheDocument();
    // Settled (terminal) result: the spinner must be gone even though the instance failed.
    expect(screen.queryByTestId('credentials-tab-verifying')).not.toBeInTheDocument();
  });

  it('keeps the spinner while a committed step is still in progress', async () => {
    (detectArtefact as jest.Mock).mockReturnValue(undefined);
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (detectVersion as jest.Mock).mockReturnValue('0.6.0');
    // First click commits a non-empty result whose step is still IN_PROGRESS (must stay
    // verifying); second click settles the same run to SUCCESS (must clear). The settle phase is
    // what makes a silently no-op commit path fail this test: the spinner would then never clear.
    (TestResults as jest.Mock).mockImplementation(({ collection, dispatch }: any) => (
      <>
        <button
          data-testid='mock-credential-progress'
          onClick={() => {
            const item = collection.items[0];
            const { runId } = dispatch((state: any) => beginRun(state, item.instanceId, [], () => 'run-mid'));
            dispatch((state: any) =>
              commitResult(state, {
                instanceId: item.instanceId,
                runId,
                result: [{ id: 'verification', name: 'Credential Verification', status: TestCaseStatus.IN_PROGRESS }],
              }),
            );
          }}
        >
          Progress
        </button>
        <button
          data-testid='mock-credential-finish'
          onClick={() => {
            const item = collection.items[0];
            dispatch((state: any) =>
              commitResult(state, {
                instanceId: item.instanceId,
                runId: 'run-mid',
                result: [{ id: 'verification', name: 'Credential Verification', status: TestCaseStatus.SUCCESS }],
              }),
            );
          }}
        >
          Finish
        </button>
      </>
    ));

    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-uploader'));
    fireEvent.click(await screen.findByTestId('mock-credential-progress'));

    expect(await screen.findByTestId('credentials-tab-verifying')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-credential-finish'));

    await waitFor(() => {
      expect(screen.queryByTestId('credentials-tab-verifying')).not.toBeInTheDocument();
    });
  });
});
