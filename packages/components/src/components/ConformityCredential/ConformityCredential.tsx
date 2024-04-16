import React, { useEffect, useMemo, useState } from 'react';
import _ from 'lodash';

import { LoadingButton } from '@mui/lab';
import { Table, TableBody, TableCell, TableRow, TableContainer, TableHead, Paper } from '@mui/material';
import { uploadJson, generateUUID, getJsonDataFromConformityAPI, hasNonEmptyObjectProperty } from '@mock-app/services';

import { checkStoredCredentials } from './utils.js';
import { Status, ToastMessage, toastMessage } from '../ToastMessage/ToastMessage.js';
import { IConformityCredentialProps, ICredentialRequestConfig } from '../../types/conformityCredential.types.js';

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
      <div style={{ marginBottom: '20px' }}>
        <LoadingButton
          component='label'
          variant='outlined'
          key={index}
          loading={loading && loadingButtonIndex === index}
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
          {JSON.parse(conformityCredentials as string)?.map((credential: any, index: number) => (
            <TableRow key={index}>
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
    localStorage.setItem('conformityCredentials', conformityCredentialsString);
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

      let conformityCredentials = JSON.parse(localStorage.getItem('conformityCredentials') ?? '[]');

      if (!_.isArray(conformityCredentials)) {
        localStorage.removeItem('conformityCredentials');
        conformityCredentials = [];
      }

      // Get the JSON data from the API
      const getJsonData = await getJsonDataFromConformityAPI(credentialRequestConfig);

      // Check if the credential already exists
      const findExistCredential = conformityCredentials.findIndex(
        (obj: any) => obj?.name === credentialRequestConfig.credentialName,
      );

      // Save the credentials to the local storage if the data is a url string
      if (_.isString(getJsonData)) {
        saveConformityCredentials(
          conformityCredentials,
          findExistCredential,
          credentialRequestConfig.credentialName,
          getJsonData,
        );
        return;
      }

      if (!hasNonEmptyObjectProperty(getJsonData, 'credentials')) {
        showErrorAndStopLoading('Invalid credentials provided in the response API');
        return;
      }

      // change tempValue to getJsonData
      if (!checkStoredCredentials(storedCredentials)) {
        showErrorAndStopLoading('Invalid stored credentials');
        return;
      }

      // Upload the credentials to the server
      const vcUrl = await uploadJson({
        filename: generateUUID(),
        json: getJsonData,
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
    const storedCredentials = localStorage.getItem('conformityCredentials');
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
