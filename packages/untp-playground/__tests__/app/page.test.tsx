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
import Home from '@/app/page';
import { mockCredential } from '../mocks/vc';
import { ArtefactKind, permittedCredentialTypes } from '../../constants';

// Mock the dependencies
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
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
  TestResults: () => <div data-testid='mock-test-results'>Test Results</div>,
}));

jest.mock('@/components/SchemeTestResults', () => ({
  SchemeTestResults: () => <div data-testid='mock-scheme-test-results'>Scheme Test Results</div>,
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
  });

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
});
