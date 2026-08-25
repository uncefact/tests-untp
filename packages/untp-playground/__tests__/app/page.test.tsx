import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import {
  decodeEnvelopedCredential,
  isEnvelopedProof,
  detectCredentialType,
  detectVersion,
} from '@/lib/credentialService';
import { detectExtension, validateCredentialSchema } from '@/lib/schemaValidation';
import { ArtefactUploader } from '@/components/ArtefactUploader';
import { SchemeTestResults } from '@/components/SchemeTestResults';
import { TestResults } from '@/components/TestResults';
import { LinkSetTestResults } from '@/components/LinkSetTestResults';
import { beginRun, commitResult, remove } from '@/lib/artefactCollection';
import { resolveLinkSet } from '@/lib/resolveLinkSet';
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
  detectCredentialType: jest.fn(),
  detectVersion: jest.fn(),
  // Real implementations: the tab-intent routing (#676) reads the link set shape and the accepted
  // family list, and mocking those would fake the very contract under test.
  isLinkSetShaped: jest.requireActual('@/lib/credentialService').isLinkSetShaped,
  acceptedArtefactFamilies: jest.requireActual('@/lib/credentialService').acceptedArtefactFamilies,
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

jest.mock('@/components/LinkSetTestResults', () => ({
  LinkSetTestResults: jest.fn(() => <div data-testid='mock-linkset-results'>Link Set Results</div>),
}));

jest.mock('@/lib/resolveLinkSet', () => ({
  resolveLinkSet: jest.fn(),
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
  DownloadCredential: jest.fn(({ family }: { family: string }) => (
    <div data-testid='mock-download'>download:{family}</div>
  )),
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
            solution:
              "Add a valid UNTP credential type (e.g., 'DigitalProductPassport', 'ConformityCredential'), or add the artefact on its own tab. The Playground accepts: Verifiable Credential, Conformity Scheme, Link Set.",
          },
          message: `The credential type is missing or invalid. The Playground accepts: Verifiable Credential, Conformity Scheme, Link Set.`,
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
    render(<Home />);
    // The tab declares intent (#676): scheme uploads happen on the Conformity Schemes tab.
    await userEvent.click(screen.getByRole('tab', { name: /Conformity Schemes/ }));

    expect(screen.getByText('No conformity schemes yet')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-uploader'));

    await waitFor(() => {
      expect(screen.queryByText('No conformity schemes yet')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('mock-scheme-test-results')).toBeInTheDocument();
  });

  it('loads two distinct schemes as separate instances instead of overwriting', async () => {
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
    // The tab declares intent (#676): scheme uploads happen on the Conformity Schemes tab.
    await userEvent.click(screen.getByRole('tab', { name: /Conformity Schemes/ }));

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);
    fireEvent.click(uploader);

    // The Conformity Schemes tab count reflects the number of loaded instances, not a single slot.
    expect(await screen.findByRole('tab', { name: /Conformity Schemes\s*2/ })).toBeInTheDocument();
  });

  it('replaces in place when the same scheme content is uploaded twice', async () => {
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
    // The tab declares intent (#676): scheme uploads happen on the Conformity Schemes tab.
    await userEvent.click(screen.getByRole('tab', { name: /Conformity Schemes/ }));

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
    // The tab declares intent (#676): scheme uploads happen on the Conformity Schemes tab.
    await userEvent.click(screen.getByRole('tab', { name: /Conformity Schemes/ }));
    fireEvent.click(screen.getByTestId('mock-uploader'));
    fireEvent.click(screen.getByTestId('mock-uploader'));

    expect(screen.queryByTestId('schemes-tab-failing-dot')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('mock-scheme-fail'));

    // Uploads now happen on the Schemes tab; switch away to prove the dot is visible cross-tab.
    await userEvent.click(screen.getByRole('tab', { name: /Credentials/ }));
    expect(screen.getByRole('tab', { name: /Credentials/ })).toHaveAttribute('data-state', 'active');
    expect(await screen.findByTestId('schemes-tab-failing-dot')).toBeInTheDocument();
    // The dot itself is aria-hidden; the state must still reach assistive tech as text.
    expect(screen.getByText('failing')).toBeInTheDocument();
  });

  it('does not show a failing dot for a warning-only scheme instance', async () => {
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
    // The tab declares intent (#676): scheme uploads happen on the Conformity Schemes tab.
    await userEvent.click(screen.getByRole('tab', { name: /Conformity Schemes/ }));
    fireEvent.click(screen.getByTestId('mock-uploader'));
    fireEvent.click(await screen.findByTestId('mock-scheme-warn'));

    // WARNING settles an instance without failing it: the count shows, no dot.
    expect(await screen.findByRole('tab', { name: /Conformity Schemes\s*1/ })).toBeInTheDocument();
    expect(screen.queryByTestId('schemes-tab-failing-dot')).not.toBeInTheDocument();
  });

  it('clears the schemes tab meta entirely when the last instance is removed', async () => {
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
    // The tab declares intent (#676): scheme uploads happen on the Conformity Schemes tab.
    await userEvent.click(screen.getByRole('tab', { name: /Conformity Schemes/ }));
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

describe('Link Sets family (#811, tab-intent routing #676)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any, source: any) => void }) => (
        <div>
          <button
            data-testid='mock-upload-linkset-file'
            onClick={() =>
              onArtefactUpload(
                { linkset: [{ anchor: 'https://id.example.org/01/1' }] },
                { kind: 'file', filename: 'linkset.json' },
              )
            }
          >
            Upload link set file
          </button>
          <button
            data-testid='mock-upload-not-a-linkset'
            onClick={() =>
              onArtefactUpload({ type: ['VerifiableCredential'] }, { kind: 'file', filename: 'credential.json' })
            }
          >
            Upload non link set
          </button>
          <button
            data-testid='mock-upload-scheme-doc'
            onClick={() =>
              onArtefactUpload({ type: ['ConformityScheme'] }, { kind: 'file', filename: 'scheme.jsonld' })
            }
          >
            Upload scheme document
          </button>
          <button
            data-testid='mock-resolve-linkset'
            onClick={() =>
              // What the uploader's resolve mode hands the page after a successful resolve: the
              // link set payload with the normalised request URL as the source (#676).
              onArtefactUpload({ linkset: [] }, { kind: 'url', url: 'https://r.example.org/01/1?linkType=all' })
            }
          >
            Resolve link set
          </button>
        </div>
      ),
    );
  });

  it('passes the active tab family to the uploader and the download component', async () => {
    render(<Home />);

    const uploaderFamily = () => (ArtefactUploader as jest.Mock).mock.lastCall?.[0]?.family;
    expect(uploaderFamily()).toMatchObject({ heading: 'Add a credential', urlMode: 'fetch' });
    expect(screen.getByTestId('mock-download')).toHaveTextContent('download:credentials');

    await userEvent.click(screen.getByRole('tab', { name: /Conformity Schemes/ }));
    // urlMode matters as much as the copy: 'resolve' here would silently route a pasted scheme
    // URL through the link set resolver instead of the generic document fetch.
    expect(uploaderFamily()).toMatchObject({ heading: 'Add a conformity scheme', urlMode: 'fetch' });
    expect(screen.getByTestId('mock-download')).toHaveTextContent('download:schemes');

    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    expect(uploaderFamily()).toMatchObject({ heading: 'Add a link set', urlMode: 'resolve' });
    expect(screen.getByTestId('mock-download')).toHaveTextContent('download:linksets');
  });

  it('ingests a link-set file uploaded on the Link Sets tab and counts it on the tab', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    fireEvent.click(screen.getByTestId('mock-upload-linkset-file'));

    expect(await screen.findByRole('tab', { name: /Link Sets\s*1/ })).toBeInTheDocument();
    expect(screen.queryByText('No link sets yet')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-linkset-results')).toBeInTheDocument();
  });

  it('rejects a non-link-set document on the Link Sets tab, naming every accepted family', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    fireEvent.click(screen.getByTestId('mock-upload-not-a-linkset'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('not a link set (no RFC 9264 "linkset" array)'));
    });
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Verifiable Credential, Conformity Scheme, Link Set'),
    );
    expect(screen.getByRole('tab', { name: 'Link Sets' })).toBeInTheDocument();
    expect(screen.getByText('No link sets yet')).toBeInTheDocument();
  });

  it('validates a link-set-shaped document as a credential when uploaded on the Credentials tab', async () => {
    // AC (#676): the tab declares intent — no cross-family routing, no auto-switching.
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectCredentialType as jest.Mock).mockReturnValue('Unknown');
    (detectExtension as jest.Mock).mockReturnValue(undefined);

    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-upload-linkset-file'));

    await waitFor(() => {
      expect(mockDispatchError).toHaveBeenCalled();
    });
    // Stays on Credentials, nothing lands in the Link Sets family.
    expect(screen.getByRole('tab', { name: /Credentials/ })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: 'Link Sets' })).toBeInTheDocument();
  });

  it('validates a scheme document as a credential when dropped on the Credentials tab, without switching', async () => {
    // AC (#676): a Conformity Scheme document on the Credentials tab fails the credential
    // pipeline there, with no auto-switch, no scheme card, and the widened family-naming error.
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectCredentialType as jest.Mock).mockReturnValue('Unknown');
    (detectExtension as jest.Mock).mockReturnValue(undefined);

    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-upload-scheme-doc'));

    await waitFor(() => {
      expect(mockDispatchError).toHaveBeenCalledWith([
        expect.objectContaining({
          message: expect.stringContaining('Verifiable Credential, Conformity Scheme, Link Set'),
        }),
      ]);
    });
    expect(screen.getByRole('tab', { name: /Credentials/ })).toHaveAttribute('data-state', 'active');
    // No scheme card was created: the Schemes tab still shows no count.
    expect(screen.queryByRole('tab', { name: /Conformity Schemes\s*1/ })).not.toBeInTheDocument();
  });

  it('replaces in place when the same resolver URL is resolved twice, even when the response drifted', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));

    fireEvent.click(screen.getByTestId('mock-resolve-linkset'));
    expect(await screen.findByRole('tab', { name: /Link Sets\s*1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-resolve-linkset'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Replaced'));
    });
    expect(screen.getByRole('tab', { name: /Link Sets\s*1/ })).toBeInTheDocument();
  });
});

describe('verify from a link set (#812)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectVersion as jest.Mock).mockReturnValue('0.6.0');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
  });

  // The link set panel renders its results component only once a link set exists, so each test
  // ingests one through the uploader mock first.
  const ingestLinkSetButton = () => {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any, source: any) => void }) => (
        <button
          data-testid='mock-upload-linkset-file'
          onClick={() => onArtefactUpload({ linkset: [] }, { kind: 'file', filename: 'linkset.json' })}
        >
          Upload link set
        </button>
      ),
    );
  };

  it('wires the credentials collection and its ingestion into the link set surface', async () => {
    ingestLinkSetButton();
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    fireEvent.click(screen.getByTestId('mock-upload-linkset-file'));
    await screen.findByTestId('mock-linkset-results');

    const props = (LinkSetTestResults as jest.Mock).mock.lastCall?.[0];
    expect(props.credentialItems).toEqual([]);
    expect(typeof props.onVerifyCredential).toBe('function');
  });

  it('enqueues a verified linked credential into Credentials without leaving the Link Sets tab', async () => {
    ingestLinkSetButton();
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    fireEvent.click(screen.getByTestId('mock-upload-linkset-file'));
    await screen.findByTestId('mock-linkset-results');

    const props = (LinkSetTestResults as jest.Mock).mock.lastCall?.[0];
    await act(async () => {
      props.onVerifyCredential(
        { type: ['VerifiableCredential', 'DigitalProductPassport'] },
        { kind: 'url', url: 'https://x.example.org/creds/dpp.json', via: 'link-set' },
      );
    });
    expect(mockDispatchError).not.toHaveBeenCalled();

    // A new instance lands on the Credentials tab (count 1, with the live verifying spinner from
    // #809 in the tab meta) while Link Sets stays active.
    const credentialsTab = await screen.findByRole('tab', { name: /Credentials.*1/ });
    expect(credentialsTab).toHaveTextContent('verifying');
    expect(screen.getByRole('tab', { name: /Link Sets/ })).toHaveAttribute('data-state', 'active');

    // The instance carries the link-set provenance source for the running subtitle (#812).
    const updated = (LinkSetTestResults as jest.Mock).mock.lastCall?.[0];
    expect(updated.credentialItems).toHaveLength(1);
    expect(updated.credentialItems[0].payload.source).toEqual({
      kind: 'url',
      url: 'https://x.example.org/creds/dpp.json',
      via: 'link-set',
    });
  });
});

describe('link-set ingestion acceptance contract (#812 review findings)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectExtension as jest.Mock).mockReturnValue(undefined);
  });

  const ingest = () => {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any, source: any) => void }) => (
        <button
          data-testid='mock-upload-linkset-file'
          onClick={() => onArtefactUpload({ linkset: [] }, { kind: 'file', filename: 'linkset.json' })}
        >
          u
        </button>
      ),
    );
  };

  it('rejects a null document without throwing, so the row can report honestly', async () => {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any, source: any) => void }) => (
        <button
          data-testid='mock-upload-linkset-file'
          onClick={() => onArtefactUpload({ linkset: [] }, { kind: 'file', filename: 'linkset.json' })}
        >
          u
        </button>
      ),
    );
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    fireEvent.click(screen.getByTestId('mock-upload-linkset-file'));
    await screen.findByTestId('mock-linkset-results');

    const props = (LinkSetTestResults as jest.Mock).mock.lastCall?.[0];
    let outcome: { accepted: boolean } | undefined;
    await act(async () => {
      outcome = props.onVerifyCredential(null, {
        kind: 'url',
        url: 'https://x.example.org/null.json',
        via: 'link-set',
      });
    });

    expect(outcome).toEqual({ accepted: false });
    expect(mockDispatchError).toHaveBeenCalled();
    // Nothing landed in the credentials collection.
    expect((LinkSetTestResults as jest.Mock).mock.lastCall?.[0].credentialItems).toEqual([]);
  });

  it('rejects a forbidden credential type with an explicit refusal, never undefined', async () => {
    (detectCredentialType as jest.Mock).mockReturnValue('Unknown');
    ingest();
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    fireEvent.click(screen.getByTestId('mock-upload-linkset-file'));
    await screen.findByTestId('mock-linkset-results');

    const props = (LinkSetTestResults as jest.Mock).mock.lastCall?.[0];
    let outcome: { accepted: boolean } | undefined;
    await act(async () => {
      outcome = props.onVerifyCredential(
        { type: ['SomethingElse'] },
        { kind: 'url', url: 'https://x.example.org/other.json', via: 'link-set' },
      );
    });

    expect(outcome).toEqual({ accepted: false });
    expect(mockDispatchError).toHaveBeenCalled();
  });

  it('returns the produced instance id when the document is accepted, and binds its URL', async () => {
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectVersion as jest.Mock).mockReturnValue('0.6.0');
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any, source: any) => void }) => (
        <button
          data-testid='mock-upload-linkset-file'
          onClick={() => onArtefactUpload({ linkset: [] }, { kind: 'file', filename: 'linkset.json' })}
        >
          u
        </button>
      ),
    );
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    fireEvent.click(screen.getByTestId('mock-upload-linkset-file'));
    await screen.findByTestId('mock-linkset-results');

    const props = (LinkSetTestResults as jest.Mock).mock.lastCall?.[0];
    let outcome: { accepted: boolean; instanceId?: string } | undefined;
    await act(async () => {
      outcome = props.onVerifyCredential(
        { type: ['VerifiableCredential', 'DigitalProductPassport'] },
        { kind: 'url', url: 'https://x.example.org/dpp.json', via: 'link-set' },
      );
    });

    expect(outcome?.accepted).toBe(true);
    expect(typeof outcome?.instanceId).toBe('string');
    expect(mockDispatchError).not.toHaveBeenCalled();

    // The page registered the URL binding, and the rows receive it on the next render.
    const updated = (LinkSetTestResults as jest.Mock).mock.lastCall?.[0];
    expect(updated.urlBindings.get('https://x.example.org/dpp.json')).toBe(outcome?.instanceId);
  });
});

describe('encrypted envelopes at ingestion (#812, every entry point)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectExtension as jest.Mock).mockReturnValue(undefined);
  });

  const envelope = {
    cipherText: 'SGVsbG8=',
    iv: 'nLUYsnXBY8bbXY45',
    tag: '7j0RRSoEIm2FAo52m1pyow==',
    type: 'aes-256-gcm',
  };

  it('reports an encrypted envelope from a link set Verify in the details drawer and flags the outcome', async () => {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any, source: any) => void }) => (
        <button
          data-testid='mock-upload-linkset-file'
          onClick={() => onArtefactUpload({ linkset: [] }, { kind: 'file', filename: 'linkset.json' })}
        >
          u
        </button>
      ),
    );
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    fireEvent.click(screen.getByTestId('mock-upload-linkset-file'));
    await screen.findByTestId('mock-linkset-results');

    const props = (LinkSetTestResults as jest.Mock).mock.lastCall?.[0];
    let outcome: { accepted: boolean; encrypted?: boolean } | undefined;
    await act(async () => {
      outcome = props.onVerifyCredential(envelope, {
        kind: 'url',
        url: 'https://documents.example.org/enc.json',
        via: 'link-set',
      });
    });

    expect(outcome).toEqual({ accepted: false, encrypted: true });
    expect(mockDispatchError).toHaveBeenCalledWith([
      expect.objectContaining({
        keyword: 'encrypted',
        message: 'This credential is encrypted, so it cannot be validated yet.',
      }),
    ]);
    // Nothing entered the credentials collection.
    expect((LinkSetTestResults as jest.Mock).mock.lastCall?.[0].credentialItems).toEqual([]);
  });

  it('reports the same encrypted warning for an upload on the Credentials tab', async () => {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (artefact: any, source: any) => void }) => (
        <button
          data-testid='mock-upload-envelope'
          onClick={() => onArtefactUpload(envelope, { kind: 'file', filename: 'enc.json' })}
        >
          u
        </button>
      ),
    );
    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-upload-envelope'));

    await waitFor(() => {
      expect(mockDispatchError).toHaveBeenCalledWith([
        expect.objectContaining({
          keyword: 'encrypted',
          message: 'This credential is encrypted, so it cannot be validated yet.',
        }),
      ]);
    });
    // Stays out of the pipeline: no credential count appears on the tab.
    expect(screen.queryByRole('tab', { name: /Credentials.*1/ })).not.toBeInTheDocument();
  });
});

describe('encrypted envelopes never route into another family (#812 follow-up)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectExtension as jest.Mock).mockReturnValue(undefined);
  });

  const envelope = {
    cipherText: 'SGVsbG8=',
    iv: 'nLUYsnXBY8bbXY45',
    tag: '7j0RRSoEIm2FAo52m1pyow==',
    type: 'aes-256-gcm',
  };
  const b64u = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const uploadOn = (artefact: any) => {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (a: any, s: any) => void }) => (
        <button data-testid='mock-upload' onClick={() => onArtefactUpload(artefact, { kind: 'file', filename: 'f' })}>
          u
        </button>
      ),
    );
  };

  it('names a compact JWE dropped on the Conformity Schemes tab encrypted instead of persisting a scheme card', async () => {
    const jwe = `${b64u('{"alg":"ECDH-ES","enc":"A256GCM"}')}..${b64u('iv')}.${b64u('ct')}.`;
    uploadOn(jwe);
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: /Conformity Schemes/ }));
    fireEvent.click(screen.getByTestId('mock-upload'));

    await waitFor(() => {
      expect(mockDispatchError).toHaveBeenCalledWith([expect.objectContaining({ keyword: 'encrypted' })]);
    });
    // No scheme card: the Schemes tab still shows no count.
    expect(screen.queryByRole('tab', { name: /Conformity Schemes\s*1/ })).not.toBeInTheDocument();
  });

  it('classifies a wrapped encrypted envelope by its inner document', async () => {
    uploadOn({ verifiableCredential: envelope });
    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-upload'));

    await waitFor(() => {
      expect(mockDispatchError).toHaveBeenCalledWith([expect.objectContaining({ keyword: 'encrypted' })]);
    });
  });

  it('accepts a genuine credential that merely carries ciphertext and header claims', async () => {
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
    (detectVersion as jest.Mock).mockReturnValue('0.6.0');
    uploadOn({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'DigitalProductPassport'],
      issuer: 'did:example:issuer',
      ciphertext: 'a public claim value',
      header: { label: 'claim metadata' },
    });
    render(<Home />);
    fireEvent.click(screen.getByTestId('mock-upload'));

    expect(await screen.findByRole('tab', { name: /Credentials.*1/ })).toBeInTheDocument();
    expect(mockDispatchError).not.toHaveBeenCalled();
  });
});

describe('secondary resolver resolution (#974)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mountLinkSets = async () => {
    (ArtefactUploader as jest.Mock).mockImplementation(
      ({ onArtefactUpload }: { onArtefactUpload: (a: any, s: any) => void }) => (
        <button
          data-testid='mock-upload-linkset-file'
          onClick={() => onArtefactUpload({ linkset: [] }, { kind: 'file', filename: 'linkset.json' })}
        >
          u
        </button>
      ),
    );
    render(<Home />);
    await userEvent.click(screen.getByRole('tab', { name: 'Link Sets' }));
    fireEvent.click(screen.getByTestId('mock-upload-linkset-file'));
    await screen.findByTestId('mock-linkset-results');
    return (LinkSetTestResults as jest.Mock).mock.lastCall?.[0];
  };

  it('resolves a secondary link exactly like the resolve input: request-URL identity, new card', async () => {
    (resolveLinkSet as jest.Mock).mockResolvedValue({
      ok: true,
      payload: { linkset: [] },
      requestUrl: 'https://r2.example.org/01/9?linkType=all',
      finalUrl: 'https://cdn.example.org/x.json',
    });
    const props = await mountLinkSets();

    await act(async () => {
      await props.onResolveSecondary('https://r2.example.org/01/9');
    });

    expect(resolveLinkSet).toHaveBeenCalledWith('https://r2.example.org/01/9');
    // Two cards now: the uploaded one and the secondary resolution.
    expect(await screen.findByRole('tab', { name: /Link Sets\s*2/ })).toBeInTheDocument();
    // Identity is the normalised REQUEST URL (ADR-046), never the post-redirect finalUrl.
    const collection = (LinkSetTestResults as jest.Mock).mock.lastCall?.[0].collection;
    const added = collection.items.find((item: any) => item.payload.source?.url?.startsWith('https://r2.example.org'));
    expect(added.contentHash).toBe('https://r2.example.org/01/9?linkType=all');
    expect(added.payload.source).toEqual({ kind: 'url', url: 'https://r2.example.org/01/9?linkType=all' });

    // Re-resolving the same URL replaces in place rather than duplicating.
    await act(async () => {
      await props.onResolveSecondary('https://r2.example.org/01/9');
    });
    expect(screen.getByRole('tab', { name: /Link Sets\s*2/ })).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Replaced'));
  });

  it('surfaces a failed secondary resolution as an error toast without adding a card', async () => {
    (resolveLinkSet as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'not-a-link-set',
      message: 'The resolver responded, but not with a link set (no RFC 9264 "linkset" array).',
    });
    const props = await mountLinkSets();

    await act(async () => {
      await props.onResolveSecondary('https://r2.example.org/x');
    });

    expect(toast.error).toHaveBeenCalledWith(
      'The resolver responded, but not with a link set (no RFC 9264 "linkset" array).',
    );
    expect(screen.getByRole('tab', { name: /Link Sets\s*1/ })).toBeInTheDocument();
  });
});
