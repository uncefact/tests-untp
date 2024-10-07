import React, { useState, useCallback, useEffect } from 'react';
import { decryptString } from '@govtechsg/oa-encryption';
import { IVerifyResult, VerifiableCredential } from '@vckit/core-types';
import { useLocation } from 'react-router-dom';
import { computeEntryHash } from '@veramo/utils';
import { Status } from '@mock-app/components';
import { publicAPI, privateAPI } from '@mock-app/services';
import * as jose from 'jose';
import { MessageText } from '../components/MessageText';
import { LoadingWithText } from '../components/LoadingWithText';
import { BackButton } from '../components/BackButton';
import Credential from '../components/Credential/Credential';
import appConfig from '../constants/app-config.json';
import { VerifyPageContext } from '../hooks/VerifyPageContext';

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
  const { search } = useLocation();
  const [currentScreen, setCurrentScreen] = useState(PassportStatus.LOADING_FETCHING_PASSPORT);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const [credential, setCredential] = useState<VerifiableCredential | null>(null);

  useEffect(() => {
    fetchEncryptedVC();
  }, [search]);

  useEffect(() => {
    if (credential) {
      setCurrentScreen(PassportStatus.LOADING_PASSPORT_VERIFIED);
      verifyCredential(credential);
    }
  }, [credential]);

  /**
   * fetchEncryptedVC function is used to fetch the encrypted VC and decrypt it
   */
  const fetchEncryptedVC = useCallback(async () => {
    try {
      const queryParams = new URLSearchParams(search);
      const payloadQuery = queryParams.get('q') || '';
      if (!payloadQuery) {
        return displayErrorUI();
      }

      const { payload } = JSON.parse(payloadQuery);
      const { uri, key, hash } = payload;
      const encryptedCredential = await publicAPI.get(uri);
      if (encryptedCredential?.credentialSubject) {
        return setCredential(encryptedCredential);
      }

      if (
        encryptedCredential?.verifiableCredential?.type.includes('EnvelopedVerifiableCredential') &&
        'id' in encryptedCredential?.verifiableCredential
      ) {
        if (encryptedCredential.verifiableCredential.id.startsWith('data:application/')) {
          return setCredential(encryptedCredential);
        } else {
          return displayErrorUI();
        }
      }

      const credentialJsonString = decryptString({
        ...encryptedCredential,
        key,
        type: 'OPEN-ATTESTATION-TYPE-1',
      });

      const credentialObject = JSON.parse(credentialJsonString);
      const credentialHash = computeEntryHash(credentialObject);
      if (credentialHash !== hash) {
        return displayErrorUI();
      }

      setCredential(credentialObject);
    } catch (error) {
      displayErrorUI();
    }
  }, [search]);

  const displayErrorUI = (
    errorMessages = ['Something went wrong. Please try again.'],
    screen: PassportStatus = PassportStatus.ERROR,
  ) => {
    setErrorMessages(errorMessages);
    setCurrentScreen(screen);
  };

  const verifyCredential = async (verifiableCredential: VerifiableCredential) => {
    try {
      const verifyCredentialParams = {
        credential: verifiableCredential,
        fetchRemoteContexts: true,
        policies: {
          credentialStatus: true,
        },
      };

      const verifyServiceUrl = appConfig.defaultVerificationServiceLink.href;
      privateAPI.setBearerTokenAuthorizationHeaders(appConfig.defaultVerificationServiceLink.apiKey ?? '');
      const verifiedCredentialResult = await privateAPI.post<IVerifyResult>(verifyServiceUrl, verifyCredentialParams);
      showVerifiedCredentialResult(verifiedCredentialResult);
    } catch (error) {
      displayErrorUI();
    }
  };

  /**
   * Show verified credential result
   * @param verifyResult
   */
  const showVerifiedCredentialResult = (verifyResult: IVerifyResult) => {
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
      case PassportStatus.VERIFY_SUCCESS:
        if (!credential) {
          return null;
        }

        let customCredential = null;

        if (credential?.verifiableCredential?.type?.includes('EnvelopedVerifiableCredential')) {
          try {
            const encodedCredential = credential.verifiableCredential.id.split(',')[1];
            customCredential = jose.decodeJwt(encodedCredential);
          } catch (error) {
            displayErrorUI();
          }
        }

        return (
          <VerifyPageContext.Provider value={{ vc: credential }}>
            <BackButton>
              <Credential credential={customCredential ?? credential} />
            </BackButton>
          </VerifyPageContext.Provider>
        );
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

export default Verify;
