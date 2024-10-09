import React, { useMemo } from 'react';
import moment from 'moment';
import { List, ListItem, ListItemText } from '@mui/material';
import { IssuerType, VerifiableCredential } from '@vckit/core-types';

const CredentialInfo = ({ credential }: { credential: VerifiableCredential }) => {
  const credentialType = useMemo(() => {
    if (typeof credential.type === 'string') {
      return credential.type;
    }

    const types = credential?.type as string[];
    const type = types?.find((item) => item !== 'VerifiableCredential');
    if (type) {
      return type;
    }

    return 'VerifiableCredential';
  }, [credential.type]);

  function processIssuer(issuer: IssuerType) {
    if (typeof issuer === 'object' && 'id' in issuer) {
      // issuer is an object with an 'id' property
      return issuer.id;
    }
    return issuer;
  }

  return (
    <List>
      <ListItem>
        <ListItemText primary='Type' secondary={credentialType} />
      </ListItem>
      <ListItem>
        <ListItemText primary='Issued by' secondary={processIssuer(credential.issuer)} />
      </ListItem>
      <ListItem>
        <ListItemText primary='Issue date' secondary={moment(credential.issuanceDate).format('MM/DD/YYYY')} />
      </ListItem>
    </List>
  );
};

export default CredentialInfo;
