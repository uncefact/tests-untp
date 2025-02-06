import { TestResults, confettiConfig } from '@/components/TestResults';
import { detectExtension, validateCredentialSchema, validateExtension } from '@/lib/schemaValidation';
import { verifyCredential } from '@/lib/verificationService';
import { Credential } from '@/types/credential';
import { act, render, screen, waitFor } from '@testing-library/react';
import confetti from 'canvas-confetti';

// Mock the external dependencies
jest.mock('@/lib/verificationService');
jest.mock('@/lib/schemaValidation');
jest.mock('@/lib/credentialService');
jest.mock('canvas-confetti');
jest.mock('jsonld', () => ({
  expand: jest.fn(),
}));
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

// Mock sample credentials
const mockBasicCredential = {
  DigitalProductPassport: {
    original: {
      proof: { type: 'Ed25519Signature2020' },
    },
    decoded: {
      '@context': ['https://vocabulary.uncefact.org/2.0.0/context.jsonld'],
      type: ['VerifiableCredential', 'DigitalProductPassport'],
    } as Credential,
  },
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

  it('renders credential section with correct type and version', async () => {
    (detectExtension as jest.Mock).mockReturnValue({
      core: { type: 'DigitalProductPassport', version: '2.0.0' },
      extension: { type: 'DigitalProductPassport', version: '2.0.0' },
    });

    render(<TestResults credentials={mockBasicCredential} />);

    // Check for the credential type heading
    const credentialSection = screen.getByRole('heading', {
      level: 3,
      name: /DigitalProductPassport.*v2\.0\.0/,
    });
    expect(credentialSection).toBeInTheDocument();
  });

  describe('Confetti Behavior', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('shows confetti when all validations pass', async () => {
      (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
      (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
      (detectExtension as jest.Mock).mockReturnValue(undefined);

      render(<TestResults credentials={mockBasicCredential} />);

      await waitFor(() => {
        expect(confetti).toHaveBeenCalledTimes(1);
        expect(confetti).toHaveBeenCalledWith(expect.objectContaining(confettiConfig));
      });
    });

    it('does not show confetti when schema validation fails', async () => {
      (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
      (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: false });
      (detectExtension as jest.Mock).mockReturnValue(undefined);

      await act(async () => {
        render(<TestResults credentials={mockBasicCredential} />);
      });

      expect(confetti).not.toHaveBeenCalled();
    });

    it('does not show confetti when extension validation fails', async () => {
      (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
      (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
      (detectExtension as jest.Mock).mockReturnValue('someExtension');
      (validateExtension as jest.Mock).mockResolvedValue({ valid: false });

      await act(async () => {
        render(<TestResults credentials={mockBasicCredential} />);
      });

      expect(confetti).not.toHaveBeenCalled();
    });

    it('does not show confetti when verification fails', async () => {
      (verifyCredential as jest.Mock).mockResolvedValue({ verified: false });
      (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
      (detectExtension as jest.Mock).mockReturnValue(undefined);

      await act(async () => {
        render(<TestResults credentials={mockBasicCredential} />);
      });

      expect(confetti).not.toHaveBeenCalled();
    });
  });
});
