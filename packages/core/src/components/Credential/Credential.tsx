import React from 'react';
import { Box } from '@mui/material';
import { VerifiableCredential } from '@vckit/core-types';
import { MessageText } from '../../components/MessageText';
import { Status } from '@mock-app/components';
import { CredentialInfo } from '../CredentialInfo';
import { CredentialTabs } from '../CredentialTabs';

const Credential = ({ credential }: { credential: VerifiableCredential }) => {
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
      <CredentialTabs credential={credential} />
    </Box>
  );
};

export default Credential;
