import { render, screen, waitFor, act } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
import { verifyCredential } from '@/services/credentials';
import VerifyPage from './page';

console.error = jest.fn();
console.log = jest.fn();

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
}));

// Mock the service
jest.mock('@/services/credentials', () => ({
  verifyCredential: jest.fn(),
}));

// Mock Credential component
jest.mock('@/components/Credential/Credential', () => ({
  __esModule: true,
  default: ({ credential }: { credential: Record<string, unknown> }) => (
    <div data-testid='credential'>{JSON.stringify(credential)}</div>
  ),
}));

// Mock MessageText component
jest.mock('@/components/MessageText', () => ({
  MessageText: ({ text }: { text: string }) => <div data-testid='message-text'>{text}</div>,
}));

jest.mock('@reference-implementation/components', () => ({
  Status: { error: 'error', success: 'success' },
  Loader: ({ text }: { text: string }) => <div data-testid='loader'>{text}</div>,
}));

const mockUseSearchParams = useSearchParams as jest.Mock;
const mockVerifyCredential = verifyCredential as jest.Mock;

function makeLegacySearchParams(q: string): URLSearchParams {
  return new URLSearchParams(`q=${encodeURIComponent(q)}`);
}

function makeValidLegacyPayload(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    payload: {
      uri: 'http://localhost:3333/v1/credentials/abc.json',
      key: 'some-key',
      hash: 'some-hash',
      ...overrides,
    },
  });
}

function makeDirectSearchParams(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe('VerifyPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state initially', () => {
    mockVerifyCredential.mockReturnValue(new Promise(() => {}));
    mockUseSearchParams.mockReturnValue(makeLegacySearchParams(makeValidLegacyPayload()));

    render(<VerifyPage />);

    expect(screen.getByTestId('loader')).toHaveTextContent('Verifying the credential');
  });

  it('calls service with correct params from legacy ?q= format', async () => {
    const payload = {
      uri: 'http://localhost:3333/v1/credentials/abc.json',
      key: 'my-key',
      hash: 'my-hash',
    };
    mockUseSearchParams.mockReturnValue(makeLegacySearchParams(JSON.stringify({ payload })));
    mockVerifyCredential.mockResolvedValue({
      verified: true,
      credential: {},
    });

    await act(async () => {
      render(<VerifyPage />);
    });

    await waitFor(() => {
      expect(mockVerifyCredential).toHaveBeenCalledWith({
        uri: 'http://localhost:3333/v1/credentials/abc.json',
        decryptionKey: 'my-key',
        hash: 'my-hash',
      });
    });
  });

  it('calls service with correct params from direct query params', async () => {
    mockUseSearchParams.mockReturnValue(
      makeDirectSearchParams({
        uri: 'http://localhost:3333/v1/credentials/abc.json',
        decryptionKey: 'my-key',
        hash: 'my-hash',
      }),
    );
    mockVerifyCredential.mockResolvedValue({
      verified: true,
      credential: {},
    });

    await act(async () => {
      render(<VerifyPage />);
    });

    await waitFor(() => {
      expect(mockVerifyCredential).toHaveBeenCalledWith({
        uri: 'http://localhost:3333/v1/credentials/abc.json',
        decryptionKey: 'my-key',
        hash: 'my-hash',
      });
    });
  });

  it('prefers direct uri param over legacy ?q= format', async () => {
    const params = new URLSearchParams({
      uri: 'http://direct.example.com/cred.json',
      q: JSON.stringify({ payload: { uri: 'http://legacy.example.com/cred.json' } }),
    });
    mockUseSearchParams.mockReturnValue(params);
    mockVerifyCredential.mockResolvedValue({
      verified: true,
      credential: {},
    });

    await act(async () => {
      render(<VerifyPage />);
    });

    await waitFor(() => {
      expect(mockVerifyCredential).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'http://direct.example.com/cred.json' }),
      );
    });
  });

  it('renders credential on verified:true', async () => {
    mockUseSearchParams.mockReturnValue(makeLegacySearchParams(makeValidLegacyPayload()));
    mockVerifyCredential.mockResolvedValue({
      verified: true,
      credential: { type: 'VerifiableCredential' },
      decodedCredential: { type: 'UnsignedCredential' },
    });

    await act(async () => {
      render(<VerifyPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('credential')).toBeInTheDocument();
    });
  });

  it('renders error on verified:false', async () => {
    mockUseSearchParams.mockReturnValue(makeLegacySearchParams(makeValidLegacyPayload()));
    mockVerifyCredential.mockResolvedValue({
      verified: false,
      credential: {},
      error: { type: 'integrity', message: 'Signature invalid' },
    });

    await act(async () => {
      render(<VerifyPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('message-text')).toHaveTextContent('Signature invalid');
    });
  });

  it('renders error on service error', async () => {
    mockUseSearchParams.mockReturnValue(makeLegacySearchParams(makeValidLegacyPayload()));
    mockVerifyCredential.mockRejectedValue(new Error('Network failure'));

    await act(async () => {
      render(<VerifyPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('message-text')).toHaveTextContent('Network failure');
    });
  });

  it('handles missing ?q= param', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());

    await act(async () => {
      render(<VerifyPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('message-text')).toHaveTextContent('Invalid verification link');
    });
  });

  it('handles malformed JSON in ?q=', async () => {
    mockUseSearchParams.mockReturnValue(makeLegacySearchParams('not-valid-json'));

    await act(async () => {
      render(<VerifyPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('message-text')).toHaveTextContent('Invalid verification link');
    });
  });

  it('handles missing uri in payload', async () => {
    mockUseSearchParams.mockReturnValue(makeLegacySearchParams(JSON.stringify({ payload: { key: 'k', hash: 'h' } })));

    await act(async () => {
      render(<VerifyPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('message-text')).toHaveTextContent('Invalid verification link');
    });
  });
});
