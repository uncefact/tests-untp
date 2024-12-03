import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { decodeEnvelopedCredential, isEnvelopedProof } from '@/lib/credentialService';
import { CredentialUploader } from '@/components/CredentialUploader';
import Home from '../../src/app/page';
import { mockCredential } from '../mocks/vc';

// Mock the dependencies
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

jest.mock('@/lib/credentialService', () => ({
  isEnvelopedProof: jest.fn(),
  decodeEnvelopedCredential: jest.fn(),
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

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  it('handles invalid credential format', async () => {
    (CredentialUploader as jest.Mock).mockImplementation(
      ({ onCredentialUpload }: { onCredentialUpload: (credential: { verifiableCredential: any }) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onCredentialUpload('' as any)}>
          Upload
        </button>
      ),
    );

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Invalid credential format');
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

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Unknown credential type');
    });
  });

  it('handles enveloped credential correctly', async () => {
    const mockEnvelopedCredential = {
      type: ['VerifiableCredential', 'DigitalProductPassport'],
    };

    (isEnvelopedProof as jest.Mock).mockReturnValue(true);
    (decodeEnvelopedCredential as jest.Mock).mockReturnValue(mockEnvelopedCredential);

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(decodeEnvelopedCredential).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
