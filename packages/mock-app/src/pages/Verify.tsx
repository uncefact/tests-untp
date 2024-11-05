import { Status } from '@mock-app/components';
import { computeHash, decryptCredential, publicAPI, verifyVC } from '@mock-app/services';
import { IVerifyResult, VerifiableCredential } from '@vckit/core-types';
import * as jose from 'jose';
import _ from 'lodash';
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import Credential from '../components/Credential/Credential';
import { LoadingWithText } from '../components/LoadingWithText';
import { MessageText } from '../components/MessageText';
import appConfig from '../constants/app-config.json';

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

      const verifyHash = (credential: VerifiableCredential) => {
        if (hash) {
          const computedHash = computeHash(credential);
          if (computedHash !== hash) return displayErrorUI(['Hash invalid']);
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
        const credentialJsonString = decryptCredential({
          cipherText,
          key,
          iv,
          tag,
          type,
        });

        credentialObject = JSON.parse(credentialJsonString);
      } else {
        credentialObject = _.cloneDeep(encryptedCredential);
      }

      return verifyHash(credentialObject);
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
  // TODO: Move this function to the vckit service
  const verifyCredential = async (verifiableCredential: VerifiableCredential) => {
    try {
      const verifyServiceUrl = appConfig.defaultVerificationServiceLink.href;
      const verifyServiceHeaders = appConfig.defaultVerificationServiceLink.headers;

      const verifiedCredentialResult = await verifyVC(verifiableCredential, verifyServiceUrl, verifyServiceHeaders);

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

        if (credential?.type?.includes('EnvelopedVerifiableCredential')) {
          try {
            const encodedCredential = credential?.id?.split(',')[1];
            customCredential = jose.decodeJwt(encodedCredential as string) as VerifiableCredential;
          } catch (error) {
            displayErrorUI();
          }
        }

        return (
          <BackButton>
            <Credential credential={credential} decodedEnvelopedVC={customCredential} />
          </BackButton>
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
