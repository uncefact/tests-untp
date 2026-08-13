'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Status } from '@reference-implementation/components';
import { VerifiableCredential, UnsignedCredential } from '@vckit/core-types';
import { Loader } from '@reference-implementation/components';
import Credential from '@/components/Credential/Credential';
import { MessageText } from '@/components/MessageText';
import {
  verifyCredential,
  VerifyCredentialError,
  VerifyCredentialParams,
  VerifyCredentialResult,
  VerifyErrorCode,
} from '@/services/credentials';

const HEX_64 = /^[a-f0-9]{64}$/i;

// Failures a re-entered key cannot fix: the credential itself (or its stored
// envelope) is unusable, so the prompt would invite pointless retries. Typed
// against VerifyErrorCode so a typo here fails to compile; declared as a set
// of strings so `.has` accepts the API's open-ended code field.
const KEY_RETRY_POINTLESS_CODES: ReadonlySet<string> = new Set<VerifyErrorCode>([
  'ENVELOPE_INVALID',
  'DECRYPTED_NOT_JSON',
  'INVALID_RESPONSE',
  'DIGEST_MISMATCH',
  'UNSUPPORTED_CREDENTIAL_TYPE',
]);

const Verify = () => {
  const search = useSearchParams();
  const [state, setState] = useState<'loading' | 'success' | 'error' | 'keyRequired'>('loading');
  const [result, setResult] = useState<VerifyCredentialResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  // The parsed link parameters are kept in state so key-prompt retries reuse
  // exactly what the link carried, rather than re-deriving it.
  const [params, setParams] = useState<VerifyCredentialParams | null>(null);
  const [keyInput, setKeyInput] = useState<string>('');
  const [keyError, setKeyError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const run = async () => {
      let uri: string | undefined;
      let digestMultibase: string | undefined;
      let hash: string | undefined;
      let decryptionKey: string | undefined;

      // A changed link resets the whole flow, including any typed key.
      setState('loading');
      setResult(null);
      setErrorMessage('');
      setParams(null);
      setKeyInput('');
      setKeyError('');
      setSubmitting(false);

      // Support individual query params and a legacy ?q= JSON envelope. The
      // verify URL has historically carried a hex `hash`; new URLs carry
      // `digestMultibase` instead. Read both so QR codes already in the wild
      // keep working alongside newly issued URLs.
      const directUri = search?.get('uri');
      if (directUri) {
        uri = directUri;
        digestMultibase = search?.get('digestMultibase') ?? undefined;
        hash = search?.get('hash') ?? undefined;
        decryptionKey = search?.get('decryptionKey') ?? undefined;
      } else {
        const q = search?.get('q');
        if (q) {
          try {
            const parsed = JSON.parse(q);
            uri = parsed?.payload?.uri;
            digestMultibase = parsed?.payload?.digestMultibase;
            hash = parsed?.payload?.hash;
            decryptionKey = parsed?.payload?.decryptionKey ?? parsed?.payload?.key;
          } catch (e) {
            console.error('Failed to parse legacy ?q= parameter:', e);
          }
        }
      }

      if (!uri) {
        setErrorMessage('Invalid verification link');
        setState('error');
        return;
      }

      const parsedParams: VerifyCredentialParams = { uri, digestMultibase, hash, decryptionKey };
      setParams(parsedParams);

      try {
        const result = await verifyCredential(parsedParams);
        setResult(result);
        setState('success');
      } catch (e: unknown) {
        if (e instanceof VerifyCredentialError && e.code === 'DECRYPTION_REQUIRED' && !parsedParams.decryptionKey) {
          setState('keyRequired');
          return;
        }
        setErrorMessage(e instanceof Error ? e.message : 'Verification failed');
        setState('error');
      }
    };

    run();
  }, [search]);

  // A back/forward-cache restore brings the JavaScript heap back, including a
  // typed key. The key is for the attempt it was typed into only, so clear it.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setKeyInput('');
        setKeyError('');
        setSubmitting(false);
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const handleKeySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    // The form must never submit natively: a native submit is a GET that
    // writes the key into the URL and browser history.
    event.preventDefault();
    if (submitting || !params) return;

    const trimmedKey = keyInput.trim();
    if (!HEX_64.test(trimmedKey)) {
      setKeyError('The key must be a 64-character hexadecimal string.');
      return;
    }

    setSubmitting(true);
    setKeyError('');
    try {
      const result = await verifyCredential({ ...params, decryptionKey: trimmedKey });
      // Clear the key before rendering the result; it has done its job.
      setKeyInput('');
      setResult(result);
      setState('success');
    } catch (e: unknown) {
      if (e instanceof VerifyCredentialError && e.code && KEY_RETRY_POINTLESS_CODES.has(e.code)) {
        setErrorMessage(e.message);
        setState('error');
      } else {
        // Wrong key, transient network trouble, or upstream failure: keep the
        // form (and the typed key) so the verifier can correct and retry.
        setKeyError(e instanceof Error ? e.message : 'Verification failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'loading') {
    return (
      <Loader text='Verifying the credential' className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' />
    );
  }

  if (state === 'keyRequired') {
    return (
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md px-4'>
        <h1 className='text-lg font-semibold mb-2'>Decryption key required</h1>
        <p className='mb-4 text-sm'>
          This credential is encrypted and the link does not include its decryption key. Enter the key you received from
          the issuer to verify the credential. The key is used for this attempt only and is not stored.
        </p>
        <form onSubmit={handleKeySubmit} noValidate>
          <label htmlFor='decryption-key' className='block text-sm font-medium mb-1'>
            Decryption key
          </label>
          <input
            id='decryption-key'
            type='text'
            autoComplete='off'
            spellCheck={false}
            autoCapitalize='none'
            autoCorrect='off'
            className='w-full border rounded px-3 py-2 mb-2 font-mono text-sm'
            placeholder='64-character hexadecimal key'
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
          />
          {keyError && (
            <p role='alert' className='text-sm text-red-600 mb-2'>
              {keyError}
            </p>
          )}
          <button
            type='submit'
            disabled={submitting}
            className='bg-primary text-white rounded px-4 py-2 text-sm disabled:opacity-50'
          >
            {submitting ? 'Verifying…' : 'Decrypt and verify'}
          </button>
        </form>
      </div>
    );
  }

  if (state === 'success' && result) {
    if (result.verified) {
      return (
        <Credential
          credential={result.credential as VerifiableCredential}
          decodedEnvelopedVC={result.decodedCredential as UnsignedCredential}
        />
      );
    }

    return (
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
        <MessageText status={Status.error} text={result.error?.message ?? 'Verification failed'} />
      </div>
    );
  }

  return (
    <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
      <MessageText status={Status.error} text={errorMessage} />
    </div>
  );
};

// The App Router keeps the page mounted when only the query string changes,
// so an in-flight verification for one link could otherwise write its result
// into a newly opened link's state. Keying by the query string remounts
// instead, discarding stale requests along with the old state.
const KeyedVerify = () => {
  const search = useSearchParams();
  return <Verify key={search?.toString() ?? ''} />;
};

/**
 * Verify component wrapped with Suspense boundary
 */
const VerifyPage = () => {
  return (
    <Suspense
      fallback={<Loader text='Loading...' className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' />}
    >
      <KeyedVerify />
    </Suspense>
  );
};

export default VerifyPage;
