'use client';

import { Status } from '@mock-app/components';
import { computeHash, decryptCredential, publicAPI, verifyVC } from '@mock-app/services';
import { IVerifyResult, VerifiableCredential } from '@vckit/core-types';
import * as jose from 'jose';
import _ from 'lodash';
import { useCallback, useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { BackButton } from '@/components/BackButton';
import Credential from '@/components/Credential/Credential';
import { LoadingWithText } from '@/components/LoadingWithText';
import { MessageText } from '@/components/MessageText';
import appConfig from '@/constants/app-config.json';

enum PassportStatus {
  'LOADING_FETCHING_PASSPORT' = 'LOADING_FETCHING_PASSPORT',
  'LOADING_PASSPORT_VERIFIED' = 'LOADING_PASSPORT_VERIFIED',
  'ERROR' = 'ERROR',
  'VERIFY_SUCCESS' = 'VERIFY_SUCCESS',
}

type VerifyError = { message: string; [k: string]: string };

/**
 *
 * Verify component is used to verify the passport
 */
const Verify = () => {
  const search = useSearchParams();
  const [currentScreen, setCurrentScreen] = useState(PassportStatus.LOADING_FETCHING_PASSPORT);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const [credential, setCredential] = useState<VerifiableCredential | null>(null);

  /**
   * fetchEncryptedVC function is used to fetch the encrypted VC and decrypt it
   */
  const fetchEncryptedVC = useCallback(async () => {
    try {
      const queryParams = new URLSearchParams(search?.toString() ?? '');
      const payloadQuery = queryParams.get('q') || '';
      if (!payloadQuery) {
        return displayErrorUI();
      }

      const { payload } = JSON.parse(payloadQuery);
      const { uri, key, hash } = payload;
      const encryptedCredential = await publicAPI.get(uri);

      const verifyHash = (credential: VerifiableCredential) => {
        if (hash) {
          const computedHash = computeHash(credential);
          if (computedHash !== hash)
            return displayErrorUI(['Failed to compare the hash in the verify URL with the VC hash.']);
        }

        return setCredential(credential);
      };

      const { cipherText, iv, tag, type } = encryptedCredential;

      let credentialObject;
      if (
        'cipherText' in encryptedCredential &&
        'iv' in encryptedCredential &&
        'tag' in encryptedCredential &&
        'type' in encryptedCredential
      ) {
        try {
          const credentialJsonString = decryptCredential({
            cipherText,
            key,
            iv,
            tag,
            type,
          });

          credentialObject = JSON.parse(credentialJsonString);
        } catch (error) {
          console.log(error);
          return displayErrorUI(['Failed to decrypt credential.']);
        }
      } else {
        credentialObject = _.cloneDeep(encryptedCredential);
      }

      return verifyHash(credentialObject);
    } catch (error) {
      console.log(error);
      displayErrorUI();
    }
  }, [search]);

  /**
   * Show verified credential result
   * @param verifyResult
   */
  const showVerifiedCredentialResult = useCallback((verifyResult: IVerifyResult) => {
    if (verifyResult?.verified) {
      return setCurrentScreen(PassportStatus.VERIFY_SUCCESS);
    }

    if (verifyResult?.error?.message) {
      return displayErrorUI([verifyResult.error.message]);
    }

    if (verifyResult?.results?.length) {
      const errorMessages = verifyResult.results.map((result: { error: VerifyError }) => result.error?.message);
      return displayErrorUI(errorMessages);
    }

    displayErrorUI();
  }, []);

  // TODO: Move this function to the vckit service
  const verifyCredential = useCallback(
    async (verifiableCredential: VerifiableCredential) => {
      try {
        const verifyServiceUrl = appConfig.defaultVerificationServiceLink.href;
        const verifyServiceHeaders = appConfig.defaultVerificationServiceLink.headers;

        const verifiedCredentialResult = await verifyVC(verifiableCredential, verifyServiceUrl, verifyServiceHeaders);

        showVerifiedCredentialResult(verifiedCredentialResult);
      } catch (error) {
        console.log(error);
        displayErrorUI();
      }
    },
    [showVerifiedCredentialResult],
  );

  useEffect(() => {
    fetchEncryptedVC();
  }, [fetchEncryptedVC, search]);

  useEffect(() => {
    if (credential) {
      setCurrentScreen(PassportStatus.LOADING_PASSPORT_VERIFIED);
      verifyCredential(credential);
    }
  }, [credential, verifyCredential]);

  const displayErrorUI = (
    errorMessages = ['Something went wrong. Please try again.'],
    screen: PassportStatus = PassportStatus.ERROR,
  ) => {
    setErrorMessages(errorMessages);
    setCurrentScreen(screen);
  };

  /*
   * renderByScreenStatus function is used to render the page by the status
   */
  const renderByScreenStatus = () => {
    switch (currentScreen) {
      case PassportStatus.LOADING_FETCHING_PASSPORT:
        return <LoadingWithText text='Fetching the credential' />;
      case PassportStatus.LOADING_PASSPORT_VERIFIED:
        return <LoadingWithText text='Verifying the credential' />;
      case PassportStatus.VERIFY_SUCCESS: {
        if (!credential) {
          return null;
        }

        let customCredential = null;

        if (credential?.type?.includes('EnvelopedVerifiableCredential')) {
          try {
            const encodedCredential = credential?.id?.split(',')[1];
            customCredential = jose.decodeJwt(encodedCredential as string) as VerifiableCredential;
          } catch (error) {
            console.log(error);
            displayErrorUI();
          }
        }

        return (
          <BackButton>
            <Credential credential={credential} decodedEnvelopedVC={customCredential} />
          </BackButton>
        );
      }
      default:
        return (
          <BackButton>
            {errorMessages.map((message, idx) => {
              return <MessageText status={Status.error} text={message} key={idx} />;
            })}
          </BackButton>
        );
    }
  };

  return renderByScreenStatus();
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
