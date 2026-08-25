import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DecryptCredential } from '@/components/DecryptCredential';

jest.mock('@/lib/decryptCredential', () => ({
  ...jest.requireActual('@/lib/decryptCredential'),
  decryptCredential: jest.fn(),
}));

// eslint-disable-next-line import/first
import { decryptCredential } from '@/lib/decryptCredential';

const envelope = {
  cipherText: 'SGVsbG8=',
  iv: 'nLUYsnXBY8bbXY45',
  tag: '7j0RRSoEIm2FAo52m1pyow==',
  type: 'aes-256-gcm',
};

describe('DecryptCredential (#813)', () => {
  const onDecrypted = jest.fn(() => true);
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the locked panel copy: lead line, masked input, action, both privacy lines', () => {
    render(<DecryptCredential envelope={envelope} onDecrypted={onDecrypted} />);

    expect(screen.getByTestId('decrypt-panel')).toHaveTextContent(
      'This credential is encrypted. Enter its decryption key to decrypt and verify it.',
    );
    expect(screen.getByTestId('decrypt-key-input')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('decrypt-submit')).toHaveTextContent('Decrypt & verify');
    expect(screen.getByTestId('decrypt-panel')).toHaveTextContent(
      'The key is used in your browser only. It is never stored, logged or sent anywhere.',
    );
    expect(screen.getByTestId('decrypt-panel')).toHaveTextContent(
      "Refreshing or closing the page clears it, so you'll need to re-enter the key.",
    );
  });

  it('disables the action on an empty key', () => {
    render(<DecryptCredential envelope={envelope} onDecrypted={onDecrypted} />);
    expect(screen.getByTestId('decrypt-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'a'.repeat(64) } });
    expect(screen.getByTestId('decrypt-submit')).toBeEnabled();
  });

  it('hands the decrypted credential up and clears the key on success', async () => {
    (decryptCredential as jest.Mock).mockResolvedValue({ ok: true, credential: { type: ['VerifiableCredential'] } });
    render(<DecryptCredential envelope={envelope} onDecrypted={onDecrypted} />);

    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'a'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));

    await waitFor(() => {
      expect(onDecrypted).toHaveBeenCalledWith({ type: ['VerifiableCredential'] });
    });
    expect(decryptCredential).toHaveBeenCalledWith(envelope, 'a'.repeat(64));
    expect(screen.getByTestId('decrypt-key-input')).toHaveValue('');
  });

  it('shows the inline error and clears the key for retry on a wrong key', async () => {
    (decryptCredential as jest.Mock).mockResolvedValue({ ok: false, reason: 'decrypt-failed' });
    render(<DecryptCredential envelope={envelope} onDecrypted={onDecrypted} />);

    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'b'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));

    expect(await screen.findByTestId('decrypt-error')).toHaveTextContent("Couldn't decrypt with that key");
    expect(screen.getByTestId('decrypt-key-input')).toHaveValue('');
    expect(onDecrypted).not.toHaveBeenCalled();
  });

  it('locks the form while the decrypt call is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    (decryptCredential as jest.Mock).mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<DecryptCredential envelope={envelope} onDecrypted={onDecrypted} />);

    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'c'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));

    expect(screen.getByTestId('decrypt-key-input')).toBeDisabled();
    expect(screen.getByTestId('decrypt-submit')).toBeDisabled();
    await act(async () => {
      release({ ok: false, reason: 'decrypt-failed' });
    });
    expect(screen.getByTestId('decrypt-key-input')).toBeEnabled();
  });
});

describe('DecryptCredential outcomes and key hygiene (#813 review findings)', () => {
  const onDecrypted = jest.fn(() => true);
  beforeEach(() => jest.clearAllMocks());

  it('names a malformed key as an input problem, distinct from a wrong key', async () => {
    (decryptCredential as jest.Mock).mockResolvedValue({ ok: false, reason: 'malformed-key' });
    render(<DecryptCredential envelope={envelope} onDecrypted={onDecrypted} />);
    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'not-a-key' } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));

    expect(await screen.findByTestId('decrypt-error')).toHaveTextContent(
      "That doesn't look like a decryption key (expected 64 hexadecimal characters)",
    );
  });

  it('keeps the lock with a message when the decrypted content is rejected as a credential', async () => {
    (decryptCredential as jest.Mock).mockResolvedValue({ ok: true, credential: 'not credential shaped' });
    onDecrypted.mockReturnValue(false);
    render(<DecryptCredential envelope={envelope} onDecrypted={onDecrypted} />);
    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'a'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));

    expect(await screen.findByTestId('decrypt-error')).toHaveTextContent(
      'Decryption succeeded, but the content is not a credential this Playground can validate',
    );
  });

  it('accepts a retry with a fresh key after a failure', async () => {
    (decryptCredential as jest.Mock)
      .mockResolvedValueOnce({ ok: false, reason: 'decrypt-failed' })
      .mockResolvedValueOnce({ ok: true, credential: { type: ['VerifiableCredential'] } });
    render(<DecryptCredential envelope={envelope} onDecrypted={onDecrypted} />);

    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'b'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));
    await screen.findByTestId('decrypt-error');

    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'a'.repeat(64) } });
    expect(screen.getByTestId('decrypt-submit')).toBeEnabled();
    fireEvent.click(screen.getByTestId('decrypt-submit'));
    await waitFor(() => {
      expect(onDecrypted).toHaveBeenCalledWith({ type: ['VerifiableCredential'] });
    });
  });

  it('never writes the key to web storage or the network across a full failure and success cycle', async () => {
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    // jsdom has no fetch; install a sentinel so any network attempt is observable.
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    (decryptCredential as jest.Mock)
      .mockResolvedValueOnce({ ok: false, reason: 'decrypt-failed' })
      .mockResolvedValueOnce({ ok: true, credential: { type: ['VerifiableCredential'] } });
    render(<DecryptCredential envelope={envelope} onDecrypted={onDecrypted} />);

    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'd'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));
    await screen.findByTestId('decrypt-error');
    fireEvent.change(screen.getByTestId('decrypt-key-input'), { target: { value: 'e'.repeat(64) } });
    fireEvent.click(screen.getByTestId('decrypt-submit'));
    await waitFor(() => {
      expect(onDecrypted).toHaveBeenCalled();
    });

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
    delete (global as any).fetch;
  });
});

describe('undecryptable encrypted forms (#813 follow-up)', () => {
  it('shows the cannot-decrypt copy with no key form for a non-canonical envelope', () => {
    render(<DecryptCredential envelope={{ ...envelope, type: 'AES-128' }} onDecrypted={jest.fn(() => true)} />);

    expect(screen.getByTestId('decrypt-unsupported')).toHaveTextContent(
      'This credential is encrypted with "AES-128", which the Playground cannot decrypt yet.',
    );
    expect(screen.getByRole('link', { name: /supported encryption methods/ })).toBeInTheDocument();
    expect(screen.queryByTestId('decrypt-key-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('decrypt-submit')).not.toBeInTheDocument();
  });
});
