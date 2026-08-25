'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  decryptCredential,
  describeUndecryptableEnvelope,
  isDecryptableEnvelope,
  type EncryptedCredentialEnvelope,
} from '@/lib/decryptCredential';
import { Loader2, Lock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DECRYPTION_DOCS_URL } from '../../constants';

/**
 * The locked card's body (#813): a masked key input and a client-side decrypt. The key lives in
 * this component's state only, for the single decrypt call. It is never written to storage of any
 * kind, the URL, logs, or any network request (the decrypt itself is WebCrypto in this tab), and
 * it is cleared on success, on failure, and with the component on unmount or card removal. A
 * refresh therefore always returns to the locked state.
 */
export function DecryptCredential({
  envelope,
  onDecrypted,
}: {
  envelope: EncryptedCredentialEnvelope;
  /** Returns whether the decrypted content was accepted as a credential (false keeps the lock). */
  onDecrypted: (credential: unknown) => boolean;
}) {
  const [key, setKey] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Unmount (collapse or removal) must not attempt state updates for an in-flight decrypt; the
  // success outcome still applies (the page owns it), so a card collapsed mid-decrypt unlocks.
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    // A page being restored from history should never carry a typed key; clear on pagehide (a
    // real navigation, never an in-app tab switch).
    const clearKey = () => {
      if (isMountedRef.current) {
        setKey('');
        setError(null);
      }
    };
    window.addEventListener('pagehide', clearKey);
    return () => {
      isMountedRef.current = false;
      window.removeEventListener('pagehide', clearKey);
    };
  }, []);

  const handleDecrypt = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsDecrypting(true);
    setError(null);
    try {
      const result = await decryptCredential(envelope, key);
      // The key has done its job either way; clear it before anything renders.
      if (isMountedRef.current) setKey('');
      if (!result.ok) {
        // A malformed key is a fixable input problem, distinguishable before any crypto ran; a
        // failed decrypt deliberately is not (wrong key and corrupt data are indistinguishable).
        if (isMountedRef.current) {
          setError(
            result.reason === 'malformed-key'
              ? "That doesn't look like a decryption key (expected 64 hexadecimal characters)"
              : "Couldn't decrypt with that key",
          );
        }
        return;
      }
      if (!onDecrypted(result.credential) && isMountedRef.current) {
        setError('Decryption succeeded, but the content is not a credential this Playground can validate');
      }
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) setIsDecrypting(false);
    }
  };

  if (!isDecryptableEnvelope(envelope)) {
    // Encrypted, but not with the storage contract this Playground can decrypt: stay locked and
    // say so; soliciting a 64-hex key that can never work would be dishonest.
    return (
      <div className='space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-4' data-testid='decrypt-panel'>
        <p className='flex items-center gap-2 text-sm font-medium' data-testid='decrypt-unsupported'>
          <Lock className='h-4 w-4 shrink-0 text-amber-700' aria-hidden='true' />
          This credential is encrypted with {describeUndecryptableEnvelope(envelope)}, which the Playground cannot
          decrypt yet.
        </p>
        <p className='text-xs text-muted-foreground'>
          Provide the decrypted credential to validate it here.{' '}
          <a href={DECRYPTION_DOCS_URL} target='_blank' rel='noopener noreferrer' className='underline'>
            See the supported encryption methods and how to request another
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className='space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-4' data-testid='decrypt-panel'>
      <p className='flex items-center gap-2 text-sm font-medium'>
        <Lock className='h-4 w-4 shrink-0 text-amber-700' aria-hidden='true' />
        This credential is encrypted. Enter its decryption key to decrypt and verify it.
      </p>
      <form
        className='flex gap-2'
        autoComplete='off'
        onSubmit={(e) => {
          e.preventDefault();
          void handleDecrypt();
        }}
      >
        <Input
          type='password'
          // 'off', not 'new-password': this is not an account password, and 'new-password'
          // invites password managers to offer generated passwords. A hint, not a guarantee.
          autoComplete='off'
          name='credential-decryption-key'
          className='flex-1 font-mono'
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={isDecrypting}
          aria-label='Decryption key'
          data-testid='decrypt-key-input'
        />
        <Button
          type='submit'
          disabled={isDecrypting || key.trim().length === 0}
          data-testid='decrypt-submit'
          className='min-w-36'
        >
          {isDecrypting ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' /> : 'Decrypt & verify'}
        </Button>
      </form>
      {error && (
        <p className='text-sm text-red-600' role='alert' data-testid='decrypt-error'>
          {error}
        </p>
      )}
      <p className='text-xs text-muted-foreground'>
        The key is used in your browser only. It is never stored, logged or sent anywhere.
      </p>
      <p className='text-xs text-muted-foreground'>
        Refreshing or closing the page clears it, so you&apos;ll need to re-enter the key.
      </p>
    </div>
  );
}
