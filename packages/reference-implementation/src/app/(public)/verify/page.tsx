'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Status } from '@reference-implementation/components';
import { VerifiableCredential, UnsignedCredential } from '@vckit/core-types';
import { Loader } from '@reference-implementation/components';
import Credential from '@/components/Credential/Credential';
import { MessageText } from '@/components/MessageText';
import { verifyCredential, VerifyCredentialResult } from '@/services/credentials';

const Verify = () => {
  const search = useSearchParams();
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [result, setResult] = useState<VerifyCredentialResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const run = async () => {
      let uri: string | undefined;
      let hash: string | undefined;
      let decryptionKey: string | undefined;

      // Support individual query params (?uri=...&hash=...&decryptionKey=...)
      // and legacy ?q= JSON envelope ({ payload: { uri, key, hash } })
      const directUri = search?.get('uri');
      if (directUri) {
        uri = directUri;
        hash = search?.get('hash') ?? undefined;
        decryptionKey = search?.get('decryptionKey') ?? undefined;
      } else {
        const q = search?.get('q');
        if (q) {
          try {
            const parsed = JSON.parse(q);
            uri = parsed?.payload?.uri;
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

      try {
        const result = await verifyCredential({ uri, hash, decryptionKey });
        setResult(result);
        setState('success');
      } catch (e: unknown) {
        setErrorMessage(e instanceof Error ? e.message : 'Verification failed');
        setState('error');
      }
    };

    run();
  }, [search]);

  if (state === 'loading') {
    return (
      <Loader text='Verifying the credential' className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' />
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

/**
 * Verify component wrapped with Suspense boundary
 */
const VerifyPage = () => {
  return (
    <Suspense
      fallback={<Loader text='Loading...' className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' />}
    >
      <Verify />
    </Suspense>
  );
};

export default VerifyPage;
