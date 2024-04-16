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

    const parseData = JSON.parse(conformityCredentials as string) ?? [];

    if (_.isEmpty(parseData) || !_.isArray(parseData)) {
      return <p>No stored credentials available</p>;
    }
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
          {JSON.parse(conformityCredentials as string)?.map((credential: any) => (
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
  const saveConformityCredentials = (
    credentials: any[],
    findExistCredential: number,
    credentialName: string,
    url: string,
  ) => {
    if (findExistCredential === -1) {
      credentials.push({
        name: credentialName,
        url,
      });
    } else {
      credentials[findExistCredential] = {
        name: credentialName,
        url: url,
      };
    }
    const conformityCredentialsString = JSON.stringify(credentials);
    localStorage.setItem(STORAGE_KEY, conformityCredentialsString);
    toastMessage({ status: Status.success, message: 'Conformity credentials have been saved' });
    setLoading(false);
    setConformityCredentials(conformityCredentialsString);
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
      if (!_.isArray(conformityCredentials)) {
        localStorage.removeItem(STORAGE_KEY);
        conformityCredentials = [];
      }

      // Get the JSON data from the API
      const getJsonData = await getJsonDataFromConformityAPI(credentialRequestConfig);
      if (!_.isString(getJsonData) || !_.isObject(getJsonData)) {
        showErrorAndStopLoading('Invalid credential data');
        return;
      }

      // Extract the credentials from the JSON data based on the path
      const extractedCredential = getCredentialByPath(getJsonData, credentialRequestConfig.credentialPath);
      if (!extractedCredential) {
        showErrorAndStopLoading('Invalid credential data');
        return;
      }

      // Check if the credential already exists
      const findExistCredential = conformityCredentials.findIndex(
        (obj: any) => obj?.name === credentialRequestConfig.credentialName,
      );

      // Save the credentials to the local storage if the data is a url string
      if (_.isString(extractedCredential)) {
        saveConformityCredentials(
          conformityCredentials,
          findExistCredential,
          credentialRequestConfig.credentialName,
          extractedCredential,
        );
        return;
      }

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
        conformityCredentials,
        findExistCredential,
        credentialRequestConfig.credentialName,
        vcUrl,
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
