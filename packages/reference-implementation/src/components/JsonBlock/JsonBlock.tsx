import { Card, CardContent } from '@mui/material';
import { UnsignedCredential, VerifiableCredential } from '@vckit/core-types';

const JsonBlock = ({ credential }: { credential: VerifiableCredential | UnsignedCredential }) => {
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
