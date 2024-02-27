import React from 'react';
import { Button, Card, CardContent } from '@mui/material';
import { VerifiableCredential } from '@vckit/core-types';

const JsonBlock = ({ credential }: { credential: VerifiableCredential }) => {
  /**
   * handle click on download button
   */
  const handleClickDownloadVC = async () => {
    const element = document.createElement('a');
    const file = new Blob([JSON.stringify(credential, null, 2)], {
      type: 'text/plain',
    });
    element.href = URL.createObjectURL(file);
    element.download = 'vc.json';
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();
  };

  return (
    <>
      <Card sx={{ width: '100%', textAlign: 'left', overflowX: 'scroll' }}>
        <Button onClick={handleClickDownloadVC} variant='contained'>
          Download
        </Button>
        <CardContent>
          <pre>{JSON.stringify(credential, null, 2)}</pre>
        </CardContent>
      </Card>
    </>
  );
};

export default JsonBlock;
