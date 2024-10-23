import React from 'react';
import CloudDownloadOutlinedIcon from '@mui/icons-material/CloudDownloadOutlined';
import { Button, useMediaQuery, useTheme } from '@mui/material';
import { UnsignedCredential, VerifiableCredential } from '@vckit/core-types';

export const DownloadCredentialButton = ({ credential }: { credential: VerifiableCredential | UnsignedCredential }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  /**
   * handle click on download button
   */
  const handleClickDownloadVC = async () => {
    const element = document.createElement('a');
    const file = new Blob([JSON.stringify({ verifiableCredential: credential }, null, 2)], {
      type: 'text/plain',
    });
    element.href = URL.createObjectURL(file);
    element.download = 'vc.json';
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();
  };

  return (
    <Button
      variant='text'
      startIcon={<CloudDownloadOutlinedIcon sx={{ marginRight: '5px' }} />}
      sx={{
        color: 'primary.main',
        textTransform: 'none',
        marginLeft: 2,
        paddingRight: 0,
        justifyContent: 'end',
        fontSize: '16px',
        '.MuiButton-startIcon': { marginRight: 0 },
      }}
      onClick={handleClickDownloadVC}
    >
      {isMobile ? '' : 'Download'}
    </Button>
  );
};
