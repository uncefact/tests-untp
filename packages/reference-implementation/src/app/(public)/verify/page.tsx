'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Status } from '@reference-implementation/components';
import { VerifiableCredential, UnsignedCredential } from '@vckit/core-types';
import { BackButton } from '@/components/BackButton';
import Credential from '@/components/Credential/Credential';
import { LoadingWithText } from '@/components/LoadingWithText';
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
            decryptionKey = parsed?.payload?.key;
          } catch {
            // Malformed JSON in q param
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
    return <LoadingWithText text='Verifying the credential' />;
  }

  if (state === 'success' && result) {
    if (result.verified) {
      return (
        <BackButton>
          <Credential
            credential={result.credential as VerifiableCredential}
            decodedEnvelopedVC={result.decodedCredential as UnsignedCredential}
          />
        </BackButton>
      );
    }

    return (
      <BackButton>
        <MessageText status={Status.error} text={result.error?.message ?? 'Verification failed'} />
      </BackButton>
    );
  }

  return (
    <BackButton>
      <MessageText status={Status.error} text={errorMessage} />
    </BackButton>
  );
};

/**
 * Verify component wrapped with Suspense boundary
 */
const VerifyPage = () => {
  return (
    <Suspense fallback={<LoadingWithText text='Loading...' />}>
      <Verify />
    </Suspense>
  );
};

export default VerifyPage;
