import React from 'react';
import { Card, CardContent } from '@mui/material';
import { VerifiableCredential } from '@vckit/core-types';

const JsonBlock = ({ credential }: { credential: VerifiableCredential }) => {
  return (
    <>
      <Card sx={{ width: '100%', textAlign: 'left', overflowX: 'scroll' }}>
        <CardContent>
          <pre>{JSON.stringify(credential, null, 2)}</pre>
        </CardContent>
      </Card>
    </>
  );
};

export default JsonBlock;
