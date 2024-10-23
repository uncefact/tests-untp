import React from 'react';
import { Box } from '@mui/material';
import { CredentialInfo } from '../CredentialInfo';
import { CredentialTabs } from '../CredentialTabs';
import { CredentialComponentProps } from '../../types/common.types';

const Credential = ({ credential, decodeCredential }: CredentialComponentProps) => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <CredentialInfo credential={credential} />
      <CredentialTabs credential={credential} decodeCredential={decodeCredential} />
    </Box>
  );
};

export default Credential;
