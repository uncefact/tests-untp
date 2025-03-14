import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import {
  decodeEnvelopedCredential,
  isEnvelopedProof,
  detectCredentialType,
  detectVersion,
} from '@/lib/credentialService';
import { detectExtension, validateCredentialSchema } from '@/lib/schemaValidation';
import { CredentialUploader } from '@/components/CredentialUploader';
import Home from '@/app/page';
import { mockCredential } from '../mocks/vc';
import { permittedCredentialTypes } from '../../constants';

// Mock the dependencies
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

jest.mock('@/lib/credentialService', () => ({
  isEnvelopedProof: jest.fn(),
  decodeEnvelopedCredential: jest.fn(),
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

jest.mock('@/components/CredentialUploader', () => ({
  CredentialUploader: jest.fn(({ onCredentialUpload }: { onCredentialUpload: (credential: any) => void }) => (
    <button
      data-testid='mock-uploader'
      onClick={() =>
        onCredentialUpload({
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

describe('Home Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all components correctly', () => {
    render(<Home />);

    expect(screen.getByTestId('mock-header')).toBeInTheDocument();
    expect(screen.getByTestId('mock-footer')).toBeInTheDocument();
    expect(screen.getByTestId('mock-test-results')).toBeInTheDocument();
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
    (CredentialUploader as jest.Mock).mockImplementation(
      ({ onCredentialUpload }: { onCredentialUpload: (credential: any) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onCredentialUpload([])}>
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
      expect(mockDispatchError).toHaveBeenNthCalledWith(2, [expectedValue]);
    });
  });

  it('handles unknown credential type', async () => {
    (CredentialUploader as jest.Mock).mockImplementation(
      ({ onCredentialUpload }: { onCredentialUpload: (credential: { verifiableCredential: any }) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onCredentialUpload(mockCredential)}>
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
      expect(toast.error).toHaveBeenCalledWith('Failed to process credential');
    });
  });
});
