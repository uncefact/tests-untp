import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
import { verifyCredential, VerifyCredentialError } from '@/services/credentials';
import VerifyPage from './page';

console.error = jest.fn();
console.log = jest.fn();

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
}));

// Mock the service, keeping the real typed error class so the page's
// `instanceof` branching is exercised against the class it actually uses.
jest.mock('@/services/credentials', () => ({
  verifyCredential: jest.fn(),
  VerifyCredentialError: jest.requireActual('@/services/credentials/verify-credential').VerifyCredentialError,
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
        digestMultibase: undefined,
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
        digestMultibase: undefined,
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

  describe('decryption key prompt', () => {
    const VALID_KEY = 'b'.repeat(64);
    const KEYLESS_Q_PAYLOAD = JSON.stringify({
      payload: {
        uri: 'http://localhost:3333/v1/credentials/abc.json',
        digestMultibase: 'zQmDigest',
      },
    });

    function decryptionRequired() {
      return new VerifyCredentialError(
        'Credential is encrypted but no decryptionKey was provided',
        422,
        'DECRYPTION_REQUIRED',
      );
    }

    async function renderKeyPrompt() {
      mockUseSearchParams.mockReturnValue(makeLegacySearchParams(KEYLESS_Q_PAYLOAD));
      mockVerifyCredential.mockRejectedValueOnce(decryptionRequired());
      await act(async () => {
        render(<VerifyPage />);
      });
      await screen.findByLabelText('Decryption key');
    }

    it('prompts for a key when a keyless ?q= link hits an encrypted credential', async () => {
      await renderKeyPrompt();

      expect(screen.getByLabelText('Decryption key')).toBeInTheDocument();
      expect(screen.getByText(/used for this attempt only and is not stored/)).toBeInTheDocument();
      expect(mockVerifyCredential).toHaveBeenCalledTimes(1);
    });

    it('the key input does not invite browser retention', async () => {
      await renderKeyPrompt();

      const input = screen.getByLabelText('Decryption key');
      expect(input).toHaveAttribute('type', 'text');
      expect(input).toHaveAttribute('autocomplete', 'off');
      expect(input).toHaveAttribute('spellcheck', 'false');
    });

    it('rejects a malformed key inline without calling the API', async () => {
      await renderKeyPrompt();

      fireEvent.change(screen.getByLabelText('Decryption key'), { target: { value: 'not-hex' } });
      fireEvent.submit(screen.getByLabelText('Decryption key').closest('form') as HTMLFormElement);

      expect(await screen.findByRole('alert')).toHaveTextContent('64-character hexadecimal');
      expect(mockVerifyCredential).toHaveBeenCalledTimes(1); // the initial attempt only
      expect(screen.getByLabelText('Decryption key')).toHaveValue('not-hex');
    });

    it('retries with the trimmed key and the originally parsed link parameters, then renders the credential', async () => {
      await renderKeyPrompt();
      mockVerifyCredential.mockResolvedValueOnce({ verified: true, credential: { type: 'VerifiableCredential' } });

      fireEvent.change(screen.getByLabelText('Decryption key'), { target: { value: `  ${VALID_KEY}\n` } });
      fireEvent.submit(screen.getByLabelText('Decryption key').closest('form') as HTMLFormElement);

      await screen.findByTestId('credential');
      expect(mockVerifyCredential).toHaveBeenLastCalledWith({
        uri: 'http://localhost:3333/v1/credentials/abc.json',
        digestMultibase: 'zQmDigest',
        hash: undefined,
        decryptionKey: VALID_KEY,
      });
    });

    it('never writes the key into the URL or web storage', async () => {
      await renderKeyPrompt();
      mockVerifyCredential.mockResolvedValueOnce({ verified: true, credential: {} });
      const hrefBefore = window.location.href;

      fireEvent.change(screen.getByLabelText('Decryption key'), { target: { value: VALID_KEY } });
      fireEvent.submit(screen.getByLabelText('Decryption key').closest('form') as HTMLFormElement);
      await screen.findByTestId('credential');

      expect(window.location.href).toBe(hrefBefore);
      expect(window.localStorage.length).toBe(0);
      expect(window.sessionStorage.length).toBe(0);
      expect(document.cookie).toBe('');
    });

    it('keeps the form and the typed key on a wrong key, showing the API message', async () => {
      await renderKeyPrompt();
      mockVerifyCredential.mockRejectedValueOnce(
        new VerifyCredentialError(
          'The decryption key does not match this credential. Check the key and try again.',
          422,
          'DECRYPTION_FAILED',
        ),
      );

      fireEvent.change(screen.getByLabelText('Decryption key'), { target: { value: VALID_KEY } });
      fireEvent.submit(screen.getByLabelText('Decryption key').closest('form') as HTMLFormElement);

      expect(await screen.findByRole('alert')).toHaveTextContent('does not match this credential');
      expect(screen.getByLabelText('Decryption key')).toHaveValue(VALID_KEY);

      // Re-entry works: a corrected key verifies.
      mockVerifyCredential.mockResolvedValueOnce({ verified: true, credential: {} });
      fireEvent.change(screen.getByLabelText('Decryption key'), { target: { value: 'c'.repeat(64) } });
      fireEvent.submit(screen.getByLabelText('Decryption key').closest('form') as HTMLFormElement);
      await screen.findByTestId('credential');
    });

    it.each([
      ['DECRYPTED_NOT_JSON', 'The credential was decrypted but its content is not valid JSON.'],
      ['INVALID_RESPONSE', 'Response from storage URI is not valid JSON'],
      ['DIGEST_MISMATCH', 'Credential digest does not match the expected digest'],
      ['UNSUPPORTED_CREDENTIAL_TYPE', 'Only EnvelopedVerifiableCredential is supported'],
    ])('goes terminal on %s instead of keeping the key form', async (code, message) => {
      await renderKeyPrompt();
      mockVerifyCredential.mockRejectedValueOnce(new VerifyCredentialError(message, 422, code));

      fireEvent.change(screen.getByLabelText('Decryption key'), { target: { value: VALID_KEY } });
      fireEvent.submit(screen.getByLabelText('Decryption key').closest('form') as HTMLFormElement);

      await waitFor(() => {
        expect(screen.getByTestId('message-text')).toHaveTextContent(message);
      });
      expect(screen.queryByLabelText('Decryption key')).not.toBeInTheDocument();
    });

    it('goes terminal on ENVELOPE_INVALID instead of inviting pointless re-entry', async () => {
      await renderKeyPrompt();
      mockVerifyCredential.mockRejectedValueOnce(
        new VerifyCredentialError(
          'The stored credential data is corrupted and cannot be decrypted. Re-entering the key will not help.',
          422,
          'ENVELOPE_INVALID',
        ),
      );

      fireEvent.change(screen.getByLabelText('Decryption key'), { target: { value: VALID_KEY } });
      fireEvent.submit(screen.getByLabelText('Decryption key').closest('form') as HTMLFormElement);

      await waitFor(() => {
        expect(screen.getByTestId('message-text')).toHaveTextContent('Re-entering the key will not help');
      });
      expect(screen.queryByLabelText('Decryption key')).not.toBeInTheDocument();
    });

    it('keeps the form on a transient failure during the retry', async () => {
      await renderKeyPrompt();
      mockVerifyCredential.mockRejectedValueOnce(new Error('Unable to connect to the verification service'));

      fireEvent.change(screen.getByLabelText('Decryption key'), { target: { value: VALID_KEY } });
      fireEvent.submit(screen.getByLabelText('Decryption key').closest('form') as HTMLFormElement);

      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect');
      expect(screen.getByLabelText('Decryption key')).toBeInTheDocument();
    });

    it('clears the typed key when the page is restored from the back/forward cache', async () => {
      await renderKeyPrompt();
      fireEvent.change(screen.getByLabelText('Decryption key'), { target: { value: VALID_KEY } });

      const pageshow = new Event('pageshow') as PageTransitionEvent;
      Object.defineProperty(pageshow, 'persisted', { value: true });
      await act(async () => {
        window.dispatchEvent(pageshow);
      });

      expect(screen.getByLabelText('Decryption key')).toHaveValue('');
    });

    it('does not prompt when the link itself carried a wrong key (terminal DECRYPTION_FAILED)', async () => {
      mockUseSearchParams.mockReturnValue(
        makeDirectSearchParams({
          uri: 'http://localhost:3333/v1/credentials/abc.json',
          decryptionKey: VALID_KEY,
        }),
      );
      mockVerifyCredential.mockRejectedValueOnce(
        new VerifyCredentialError('The decryption key does not match this credential.', 422, 'DECRYPTION_FAILED'),
      );

      await act(async () => {
        render(<VerifyPage />);
      });

      await waitFor(() => {
        expect(screen.getByTestId('message-text')).toHaveTextContent('does not match');
      });
      expect(screen.queryByLabelText('Decryption key')).not.toBeInTheDocument();
    });
  });
});
