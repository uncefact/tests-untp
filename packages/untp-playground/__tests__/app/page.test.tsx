import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import {
  decodeEnvelopedCredential,
  isEnvelopedProof,
  detectCredentialType,
  detectVersion,
} from '@/lib/credentialService';
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
  ...jest.requireActual('@/lib/credentialService'),
  isEnvelopedProof: jest.fn(),
  decodeEnvelopedCredential: jest.fn(),
  detectVersion: jest.fn(),
}));

jest.mock('@/lib/utils', () => ({
  ...jest.requireActual('@/lib/utils'),
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



jest.mock('@/components/CredentialUploader', () => ({
  CredentialUploader: jest.fn(({ onCredentialUpload }: { onCredentialUpload: (credential: { credential: any; fileName: string }) => void }) => (
    <button
      data-testid='mock-uploader'
      onClick={() =>
        onCredentialUpload({ credential: mockCredential, fileName: 'mock-credential.json' })
      }
    >
      Upload
    </button>
  )),
}));

jest.mock('untp-test-suite-mocha', () => ({
  UNTPTestRunner: jest.fn(() => ({
    run: jest.fn(),
  })),
  setCredentialData: jest.fn(),
  executeRegisteredTestSuites: jest.fn(),
}));

jest.mock('@/components/DownloadCredential', () => ({
  DownloadCredential: () => <div data-testid='mock-download'>Download</div>,
}));

describe('Home Component', () => {
  beforeAll(() => {
    // Mock the global mocha object
    (window as any).mocha = {
      setup: jest.fn(),
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all components correctly', () => {
    render(<Home />);

    expect(screen.getByTestId('mock-header')).toBeInTheDocument();
    expect(screen.getByTestId('mock-footer')).toBeInTheDocument();

    expect(screen.getByTestId('mock-uploader')).toBeInTheDocument();
    expect(screen.getByTestId('mock-download')).toBeInTheDocument();
  });

  it('handles valid credential upload', async () => {
    const nonEnvelopedCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'DigitalProductPassport'],
      issuer: { id: 'did:web:example.com' },
      credentialSubject: { id: 'did:web:example.com/subject' },
    };

    (CredentialUploader as jest.Mock).mockImplementation(
      ({ onCredentialUpload }: { onCredentialUpload: (credential: { credential: any; fileName: string }) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onCredentialUpload({ credential: nonEnvelopedCredential, fileName: 'valid-non-enveloped.json' })}>
          Upload
        </button>
      ),
    );

    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
    (detectVersion as jest.Mock).mockReturnValue('0.5.0');

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  it('handles invalid credential format', async () => {
    (CredentialUploader as jest.Mock).mockImplementation(
      ({ onCredentialUpload }: { onCredentialUpload: (credential: { credential: any; fileName: string }) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onCredentialUpload({ credential: [], fileName: 'invalid.json' })}>
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
    const unknownTypeCredential = {
      verifiableCredential: {
        ...mockCredential.verifiableCredential,
        type: ['VerifiableCredential', 'UnknownCredentialType'],
      },
    };

    (CredentialUploader as jest.Mock).mockImplementation(
      ({ onCredentialUpload }: { onCredentialUpload: (credential: { credential: any; fileName: string }) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onCredentialUpload({ credential: unknownTypeCredential, fileName: 'unknown-type.json' })}>
          Upload
        </button>
      ),
    );

    (isEnvelopedProof as jest.Mock).mockReturnValue(false);
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
            receivedValue: unknownTypeCredential.verifiableCredential,
            solution: "Add a valid UNTP credential type (e.g., 'DigitalProductPassport', 'ConformityCredential').",
          },
          message: `The credential type is missing or invalid.`,
        },
      ]);
    });
  });

  it('handles enveloped credential correctly', async () => {
    const envelopedCredential = {
      verifiableCredential: {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'DigitalProductPassport'],
        issuer: { id: 'did:web:example.com' },
        credentialSubject: { id: 'did:web:example.com/subject' },
      },
      proof: {
        type: 'JsonWebSignature2020',
        jws: 'some.jwt.token',
      },
    };

    (CredentialUploader as jest.Mock).mockImplementation(
      ({ onCredentialUpload }: { onCredentialUpload: (credential: { credential: any; fileName: string }) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onCredentialUpload({ credential: envelopedCredential, fileName: 'enveloped.json' })}>
          Upload
        </button>
      ),
    );

    (isEnvelopedProof as jest.Mock).mockReturnValue(true);
    (decodeEnvelopedCredential as jest.Mock).mockReturnValue(envelopedCredential.verifiableCredential);
    (detectVersion as jest.Mock).mockReturnValue('0.5.0');

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

    (CredentialUploader as jest.Mock).mockImplementation(
      ({ onCredentialUpload }: { onCredentialUpload: (credential: { credential: any; fileName: string }) => void }) => (
        <button data-testid='mock-uploader' onClick={() => onCredentialUpload({ credential: mockCredential, fileName: 'error-decoding.json' })}>
          Upload
        </button>
      ),
    );

    render(<Home />);

    const uploader = screen.getByTestId('mock-uploader');
    fireEvent.click(uploader);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to process credential');
    });
  });
});
