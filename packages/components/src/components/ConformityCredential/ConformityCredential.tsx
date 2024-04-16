import React, { useEffect, useMemo, useState } from 'react';
import _ from 'lodash';

import { LoadingButton } from '@mui/lab';
import { Table, TableBody, TableCell, TableRow, TableContainer, TableHead, Paper } from '@mui/material';
import { uploadJson, generateUUID, getJsonDataFromConformityAPI } from '@mock-app/services';

import { checkStoredCredentials, getCredentialByPath } from './utils.js';
import { Status, ToastMessage, toastMessage } from '../ToastMessage/ToastMessage.js';
import { IConformityCredentialProps, ICredentialRequestConfig } from '../../types/conformityCredential.types.js';

const STORAGE_KEY = 'conformityCredentials';

export const ConformityCredential: React.FC<IConformityCredentialProps> = ({
  credentialRequestConfigs,
  storedCredentials,
}) => {
  const [conformityCredentials, setConformityCredentials] = useState<string>();
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingButtonIndex, setLoadingButtonIndex] = useState<number>(-1);

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
          loading={loading && loadingButtonIndex === index}
          disabled={loading && loadingButtonIndex !== index}
          onClick={() => {
            setLoadingButtonIndex(index);
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

    const parseCredentials = JSON.parse(conformityCredentials as string) ?? [];

    if (_.isEmpty(parseCredentials) || !_.isObject(parseCredentials)) {
      return <p>No stored credentials available</p>;
    }

    // Flatten the credentials in localStorage into an array
    const flattenedData = Object.entries(parseCredentials).flatMap(([app, credentials]) =>
      (credentials as any[]).map((credential) => ({ app, ...credential })),
    );

    return (
      <TableContainer sx={{ maxWidth: 650 }} component={Paper}>
        <Table aria-label='simple table'></Table>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 200 }}>Credential Name</TableCell>
            <TableCell>URL</TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {flattenedData?.map((credential: any) => (
            <TableRow key={credential.name}>
              <TableCell>{credential.name}</TableCell>
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
  const saveConformityCredentials = (credentialName: string, url: string, credentialAppExclusive: string) => {
    let storedData = localStorage.getItem(STORAGE_KEY);
    let dataObject = storedData ? JSON.parse(storedData) : {};

    // Update the data with the new credential
    let credentialAppData = dataObject[credentialAppExclusive] || [];
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
    dataObject[credentialAppExclusive] = credentialAppData;
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

      let conformityCredentials = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (!_.isObject(conformityCredentials)) {
        localStorage.removeItem(STORAGE_KEY);
        conformityCredentials = {};
      }

      // Get the JSON data from the API
      const getJsonData = await getJsonDataFromConformityAPI(credentialRequestConfig);

      // Extract the credentials from the JSON data based on the path
      const extractedCredential = getCredentialByPath(getJsonData, credentialRequestConfig.credentialPath);
      if (!extractedCredential) {
        showErrorAndStopLoading('Invalid credential data');
        return;
      }

      // Save the credentials to the local storage if the data is a url string
      if (_.isString(extractedCredential)) {
        saveConformityCredentials(
          credentialRequestConfig.credentialName,
          extractedCredential,
          credentialRequestConfig.credentialAppExclusive,
        );
        return;
      }

      // Check if the stored credentials are valid
      if (!checkStoredCredentials(storedCredentials)) {
        showErrorAndStopLoading('Invalid stored credentials');
        return;
      }

      // Upload the credentials to the server
      const vcUrl = await uploadJson({
        filename: generateUUID(),
        json: extractedCredential,
        bucket: storedCredentials?.options?.bucket as string,
        storageAPIUrl: storedCredentials.url,
      });

      saveConformityCredentials(
        credentialRequestConfig.credentialName,
        vcUrl,
        credentialRequestConfig.credentialAppExclusive,
      );

      return;
    } catch (error) {
      showErrorAndStopLoading('Something went wrong! Please retry again');
      console.error(error);
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
