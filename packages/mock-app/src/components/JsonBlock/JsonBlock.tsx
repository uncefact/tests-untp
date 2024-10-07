import React, { useContext, useMemo } from 'react';
import { Button, Card, CardContent } from '@mui/material';
import { VerifiableCredential } from '@vckit/core-types';
import { VerifyPageContext } from '../../hooks/VerifyPageContext';

const JsonBlock = ({ credential }: { credential: VerifiableCredential }) => {
  const { vc } = useContext(VerifyPageContext);
  /**
   * handle click on download button
   */
  const handleClickDownloadVC = async () => {
    const element = document.createElement('a');
    const file = new Blob([JSON.stringify(vc, null, 2)], {
      type: 'text/plain',
    });
    element.href = URL.createObjectURL(file);
    element.download = 'vc.json';
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();
  };

  const renderDownloadButton = useMemo(() => {
    if (vc?.verifiableCredential?.type?.includes('EnvelopedVerifiableCredential')) {
      return (
        <Button onClick={handleClickDownloadVC} variant='contained'>
          Download JWT
        </Button>
      );
    }

    return (
      <Button onClick={handleClickDownloadVC} variant='contained'>
        Download
      </Button>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vc]);

  return (
    <>
      <Card sx={{ width: '100%', textAlign: 'left', overflowX: 'scroll' }}>
        {renderDownloadButton}
        <CardContent>
          <pre>{JSON.stringify(credential, null, 2)}</pre>
        </CardContent>
      </Card>
    </>
  );
};

export default JsonBlock;
