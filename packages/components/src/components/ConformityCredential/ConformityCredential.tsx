import React, { useEffect, useMemo, useState } from 'react';
import _ from 'lodash';

import { LoadingButton } from '@mui/lab';
import { Table, TableBody, TableCell, TableRow, TableContainer, TableHead, Paper } from '@mui/material';
import {
  detectValueFromStorage,
  generateUUID,
  getJsonDataFromConformityAPI,
  getStorageServiceLink,
  getValueByPath,
} from '@mock-app/services';

import { checkStoredCredentialsConfig } from './utils.js';
import { Status, ToastMessage, toastMessage } from '../ToastMessage/ToastMessage.js';
import {
  IConformityCredentialProps,
  ICredentialRequestConfig,
  IConformityCredential,
} from '../../types/conformityCredential.types.js';
import { STORAGE_KEY } from '../../constants/conformityCredential.js';

export const ConformityCredential: React.FC<IConformityCredentialProps> = ({
  credentialRequestConfigs,
  storedCredentialsConfig,
}) => {
  const [conformityCredentials, setConformityCredentials] = useState<string>();
  const [loading, setLoading] = useState<boolean>(false);
  const [disabledButtonByIndex, setDisabledButtonByIndex] = useState<number>(-1);

  // Render buttons based on credentialConfigs
  const renderButtons = () => {
    if (!_.isArray(credentialRequestConfigs) || credentialRequestConfigs?.length < 1) {
      return <p>No credential requests available</p>;
    }

    return credentialRequestConfigs?.map((config, index) => (
      <div key={config.credentialName} style={{ marginBottom: '20px' }}>
        <LoadingButton
          component='label'
          variant='outlined'
          key={config.credentialName}
          loading={loading && disabledButtonByIndex === index}
          disabled={loading && disabledButtonByIndex !== index}
          onClick={() => {
            setDisabledButtonByIndex(index);
            onClickStorageCredential(config);
          }}
        >
          {config.credentialName}
        </LoadingButton>
      </div>
    ));
  };

  // Render table of stored credentials
  const renderStoredCredentialsTable = useMemo(() => {
    if (!conformityCredentials) {
      return;
    }

    const parseCredentials = JSON.parse(conformityCredentials as string) ?? {};

    if (_.isEmpty(parseCredentials) || !_.isObject(parseCredentials)) {
      return <p>No stored credentials available</p>;
    }

    const flattenedData = Object.entries(parseCredentials).flatMap(([app, credentials]) =>
      (credentials as any[]).map((credential) => ({ app, ...credential })),
    );

    return (
      <TableContainer component={Paper}>
        <Table aria-label='simple table'></Table>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 200 }}>Credential Name</TableCell>
            <TableCell sx={{ width: 200 }}>Context of the app</TableCell>
            <TableCell>URL</TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {flattenedData?.map((credential: IConformityCredential) => (
            <TableRow key={credential.name}>
              <TableCell>{credential.name}</TableCell>
              <TableCell>{credential.app}</TableCell>
              <TableCell>
                <a href={credential.url}>{credential.url}</a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </TableContainer>
    );
  }, [conformityCredentials]);

  // Helper function to save credentials
  const saveConformityCredentials = (credentialName: string, url: string, appOnly: string) => {
    let storedData = localStorage.getItem(STORAGE_KEY);
    let dataObject = storedData ? JSON.parse(storedData) : {};

    // Update the data with the new credential
    let credentialAppData = dataObject[appOnly] ?? [];
    let existingCredentialIndex = credentialAppData.findIndex((credential: any) => credential.name === credentialName);
    if (existingCredentialIndex !== -1) {
      // Update an existing credential
      credentialAppData[existingCredentialIndex] = {
        name: credentialName,
        url,
      };
    } else {
      // Add a new credential
      credentialAppData.push({ name: credentialName, url });
    }
    dataObject[appOnly] = credentialAppData;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataObject));

    toastMessage({ status: Status.success, message: 'Conformity credentials have been saved' });
    setLoading(false);
    setConformityCredentials(JSON.stringify(dataObject));
  };

  const showErrorAndStopLoading = (message: string) => {
    setLoading(false);
    toastMessage({ status: Status.error, message });
  };

  // Handle credential request
  const onClickStorageCredential = async (credentialRequestConfig: ICredentialRequestConfig) => {
    setLoading(true);
    try {
      if (_.isEmpty(credentialRequestConfig.url)) {
        showErrorAndStopLoading('Invalid credential request config url');
        return;
      }

      let conformityCredentials = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      if (!_.isObject(conformityCredentials)) {
        localStorage.removeItem(STORAGE_KEY);
        conformityCredentials = {};
      }

      // Get the JSON data from the API
      const getJsonData = await getJsonDataFromConformityAPI(credentialRequestConfig);

      // Extract the credentials from the JSON data based on the path
      const extractedCredential = getValueByPath(getJsonData, credentialRequestConfig.credentialPath);
      if (!extractedCredential) {
        showErrorAndStopLoading('Invalid credential data');
        return;
      }

      // Save the credentials to the local storage if the data is a url string
      if (_.isString(extractedCredential)) {
        if (!new URL(extractedCredential)) {
          showErrorAndStopLoading('Data should be URL');
          return;
        }
        saveConformityCredentials(
          credentialRequestConfig.credentialName,
          extractedCredential,
          credentialRequestConfig.appOnly,
        );
        return;
      }

      // Check if the stored credentials are valid
      const { ok, value } = checkStoredCredentialsConfig(storedCredentialsConfig);
      if (!ok) {
        showErrorAndStopLoading(value);
        return;
      }

      const vcUrl = await getStorageServiceLink(storedCredentialsConfig, extractedCredential, generateUUID());
      const verifyURL = detectValueFromStorage(vcUrl);
      saveConformityCredentials(credentialRequestConfig.credentialName, verifyURL, credentialRequestConfig.appOnly);

      return;
    } catch (error) {
      const e = error as Error;
      showErrorAndStopLoading(e.message ?? 'Something went wrong! Please retry again');
      console.error(e);
      return;
    }
  };

  useEffect(() => {
    const storedCredentials = localStorage.getItem(STORAGE_KEY);
    if (storedCredentials) {
      setConformityCredentials(storedCredentials);
    }
  }, []);

  return (
    <main style={{ marginTop: '100px' }}>
      <section>
        <h2>Credential Requests</h2>
        {renderButtons()}
      </section>
      <section>
        <h2>Stored Credentials</h2>
        {renderStoredCredentialsTable}
      </section>

      <ToastMessage />
    </main>
  );
};
