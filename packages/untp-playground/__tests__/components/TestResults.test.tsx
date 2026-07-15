import { TestResults, confettiConfig } from '@/components/TestResults';
import { validateContext } from '@/lib/contextValidation';
import { detectExtension, validateCredentialSchema, validateExtension } from '@/lib/schemaValidation';
import { detectVcdmVersion } from '@/lib/utils';
import { validateVcdmRules } from '@/lib/vcdm-validation';
import { verifyCredential } from '@/lib/verificationService';
import { Credential } from '@/types/credential';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import confetti from 'canvas-confetti';
import { CredentialType, TestCaseStatus, TestCaseStepId, VCDMVersion, VCDM_CONTEXT_URLS } from '../../constants';

jest.mock('@/lib/verificationService');
jest.mock('@/lib/schemaValidation');
jest.mock('@/lib/vcdm-validation');
jest.mock('@/lib/utils');
jest.mock('@/lib/credentialService');
jest.mock('@/lib/contextValidation');
jest.mock('canvas-confetti');
jest.mock('jsonld', () => ({
  expand: jest.fn(),
  compact: jest.fn(),
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
      '@context': [VCDM_CONTEXT_URLS.v2, 'https://vocabulary.uncefact.org/2.0.0/context.jsonld'],
      type: ['VerifiableCredential', 'DigitalProductPassport'],
    } as Credential,
  },
};

const mockSetTestResults = jest.fn();
const mockTestResults = {};

describe('TestResults Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    // Setup default mock implementations
    (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
    (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
    (validateExtension as jest.Mock).mockResolvedValue({ valid: true });
    (validateVcdmRules as jest.Mock).mockResolvedValue({ valid: true });
    (validateContext as jest.Mock).mockResolvedValue({ valid: true, data: {} });
    (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.V1);
  });

  it('renders empty state correctly', () => {
    render(<TestResults credentials={{}} testResults={mockTestResults} setTestResults={mockSetTestResults} />);
    expect(screen.getByText('DigitalProductPassport')).toBeInTheDocument();
    expect(screen.getByText('DigitalConformityCredential')).toBeInTheDocument();
    expect(screen.getByText('DigitalFacilityRecord')).toBeInTheDocument();
    expect(screen.getByText('DigitalIdentityAnchor')).toBeInTheDocument();
    expect(screen.getByText('DigitalTraceabilityEvent')).toBeInTheDocument();
  });

  it('renders credential section with correct type, version and VCDM version', async () => {
    (detectExtension as jest.Mock).mockReturnValue({
      core: { type: 'DigitalProductPassport', version: '2.0.0' },
      extension: { type: 'DigitalProductPassport', version: '2.0.0' },
    });
    (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.V1);

    render(
      <TestResults
        credentials={mockBasicCredential}
        testResults={mockTestResults}
        setTestResults={mockSetTestResults}
      />,
    );

    // Check for the credential type heading and version
    const credentialSection = screen.getByRole('heading', {
      level: 3,
      name: /DigitalProductPassport.*v2\.0\.0/,
    });
    expect(credentialSection).toBeInTheDocument();

    // Check for VCDM version badge
    expect(screen.getByText('VCDM v1')).toBeInTheDocument();
  });

  it('shows unsupported VCDM version badge when version is unknown', async () => {
    (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.UNKNOWN);

    render(
      <TestResults
        credentials={mockBasicCredential}
        testResults={mockTestResults}
        setTestResults={mockSetTestResults}
      />,
    );
    expect(screen.getByText('Unsupported VCDM version')).toBeInTheDocument();
  });

  describe('VCDM Validation', () => {
    it('shows success for valid VCDM schema validation', async () => {
      (validateVcdmRules as jest.Mock).mockResolvedValue({ valid: true });
      (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.V1);

      const mockTestSteps = {
        [CredentialType.DIGITAL_PRODUCT_PASSPORT]: [
          {
            id: TestCaseStepId.VCDM_SCHEMA_VALIDATION,
            status: TestCaseStatus.SUCCESS,
            name: 'VCDM Schema Validation',
            details: 'Valid VCDM schema',
          },
        ],
      };

      await act(async () => {
        render(
          <TestResults
            credentials={mockBasicCredential}
            testResults={mockTestSteps}
            setTestResults={mockSetTestResults}
          />,
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId('DigitalProductPassport-status-icon-success')).toBeInTheDocument();
      });

      await act(async () => {
        const groupHeader = screen.getByTestId('DigitalProductPassport-group-header');
        expect(groupHeader).toBeInTheDocument();
        fireEvent.click(groupHeader!);
      });

      await waitFor(() => {
        expect(screen.getByText(/vcdm schema validation/i)).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(validateVcdmRules).toHaveBeenCalledWith(mockBasicCredential.DigitalProductPassport.decoded);
      });
    });

    it('shows failure for invalid VCDM schema validation', async () => {
      const mockTestSteps = {
        [CredentialType.DIGITAL_PRODUCT_PASSPORT]: [
          {
            id: TestCaseStepId.VCDM_SCHEMA_VALIDATION,
            name: 'VCDM Schema Validation',
            status: TestCaseStatus.FAILURE,
            details: 'Invalid VCDM schema',
          },
        ],
      };

      render(
        <TestResults
          credentials={mockBasicCredential}
          testResults={mockTestSteps}
          setTestResults={mockSetTestResults}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('DigitalProductPassport-status-icon-failure')).toBeInTheDocument();
      });
    });

    it('handles VCDM schema fetch errors', async () => {
      const mockToast = jest.spyOn(require('sonner').toast, 'error');
      (validateVcdmRules as jest.Mock).mockRejectedValue(new Error('Failed to fetch schema'));

      await act(async () => {
        render(
          <TestResults
            credentials={mockBasicCredential}
            testResults={mockTestResults}
            setTestResults={mockSetTestResults}
          />,
        );
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith('Failed to fetch the VCDM schema. Please contact support.');
      });
    });
  });

  describe('Confetti Behavior', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('shows confetti when all validations pass', async () => {
      (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
      (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
      (validateVcdmRules as jest.Mock).mockResolvedValue({ valid: true });
      (detectExtension as jest.Mock).mockReturnValue(undefined);
      (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.V1);

      render(
        <TestResults
          credentials={mockBasicCredential}
          testResults={mockTestResults}
          setTestResults={mockSetTestResults}
        />,
      );

      await waitFor(() => {
        expect(confetti).toHaveBeenCalledTimes(1);
        expect(confetti).toHaveBeenCalledWith(expect.objectContaining(confettiConfig));
      });
    });

    it('does not show confetti when VCDM validation fails', async () => {
      (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
      (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
      (validateVcdmRules as jest.Mock).mockResolvedValue({ valid: false });
      (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.V1);

      await act(async () => {
        render(
          <TestResults
            credentials={mockBasicCredential}
            testResults={mockTestResults}
            setTestResults={mockSetTestResults}
          />,
        );
      });

      expect(confetti).not.toHaveBeenCalled();
    });

    it('does not show confetti when schema validation fails', async () => {
      (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
      (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: false });
      (detectExtension as jest.Mock).mockReturnValue(undefined);

      await act(async () => {
        render(
          <TestResults
            credentials={mockBasicCredential}
            testResults={mockTestResults}
            setTestResults={mockSetTestResults}
          />,
        );
      });

      expect(confetti).not.toHaveBeenCalled();
    });

    it('does not show confetti when extension validation fails', async () => {
      (verifyCredential as jest.Mock).mockResolvedValue({ verified: true });
      (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
      (detectExtension as jest.Mock).mockReturnValue('someExtension');
      (validateExtension as jest.Mock).mockResolvedValue({ valid: false });

      await act(async () => {
        render(
          <TestResults
            credentials={mockBasicCredential}
            testResults={mockTestResults}
            setTestResults={mockSetTestResults}
          />,
        );
      });

      expect(confetti).not.toHaveBeenCalled();
    });

    it('does not show confetti when verification fails', async () => {
      (verifyCredential as jest.Mock).mockResolvedValue({ verified: false });
      (validateCredentialSchema as jest.Mock).mockResolvedValue({ valid: true });
      (detectExtension as jest.Mock).mockReturnValue(undefined);

      await act(async () => {
        render(
          <TestResults
            credentials={mockBasicCredential}
            testResults={mockTestResults}
            setTestResults={mockSetTestResults}
          />,
        );
      });

      expect(confetti).not.toHaveBeenCalled();
    });
  });
});
