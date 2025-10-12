import { Box } from '@mui/material';
import { CredentialInfo } from '../CredentialInfo';
import { CredentialTabs } from '../CredentialTabs';
import { CredentialComponentProps } from '../../types/common.types';

const Credential = ({ credential, decodedEnvelopedVC }: CredentialComponentProps) => {
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
      <CredentialInfo credential={decodedEnvelopedVC ?? credential} />
      <CredentialTabs credential={credential} decodedEnvelopedVC={decodedEnvelopedVC} />
    </Box>
  );
};

export default Credential;
