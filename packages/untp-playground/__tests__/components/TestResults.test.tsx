import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { TestResults } from '@/components/TestResults';
import { verifyCredential } from '@/lib/verificationService';
import { detectExtension, validateCredentialSchema, validateExtension } from '@/lib/schemaValidation';
import { Credential } from '@/types/credential';
import { isEnvelopedProof } from '@/lib/credentialService';

// Mock the external dependencies
jest.mock('@/lib/verificationService');
jest.mock('@/lib/schemaValidation');
jest.mock('@/lib/credentialService');
jest.mock('canvas-confetti');
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

// Mock sample credentials
const mockBasicCredential = {
  original: {
    proof: {
      type: 'Ed25519Signature2020',
    },
  },
  decoded: {
    '@context': ['https://vocabulary.uncefact.org/2.0.0/context.jsonld'],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
  } as Credential,
};

const mockExtensionCredential = {
  original: {
    proof: {
      type: 'Ed25519Signature2020',
    },
  },
  decoded: {
    '@context': ['https://vocabulary.uncefact.org/2.0.0/context.jsonld'],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    credentialSubject: {
      type: 'ExtensionType',
      version: '1.0.0',
    },
  } as Credential,
};

describe('TestResults Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    // Setup default mock implementations
    (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
    (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
    (validateExtension as jest.Mock).mockResolvedValue({ valid: true });
  });

  it('renders empty state correctly', () => {
    render(<TestResults credentials={{}} />);

    // Check if all credential types are rendered
    expect(screen.getByText('DigitalProductPassport')).toBeInTheDocument();
    expect(screen.getByText('DigitalConformityCredential')).toBeInTheDocument();
    expect(screen.getByText('DigitalFacilityRecord')).toBeInTheDocument();
    expect(screen.getByText('DigitalIdentityAnchor')).toBeInTheDocument();
    expect(screen.getByText('DigitalTraceabilityEvent')).toBeInTheDocument();
  });

  it('enders credential section with correct type and version', async () => {
    (detectExtension as jest.Mock).mockReturnValue({
      core: { type: 'DigitalProductPassport', version: '2.0.0' },
      extension: { type: 'DigitalProductPassport', version: '2.0.0' },
    });

    render(<TestResults credentials={{ DigitalProductPassport: mockBasicCredential }} />);

    // Check for the credential type heading
    const credentialSection = screen.getByRole('heading', {
      level: 3,
      name: /DigitalProductPassport.*v2\.0\.0/,
    });
    expect(credentialSection).toBeInTheDocument();
  });
});
