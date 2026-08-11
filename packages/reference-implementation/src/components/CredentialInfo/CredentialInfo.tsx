'use client';

import { useMemo } from 'react';
import moment from 'moment';
import { List, ListItem, ListItemText } from '@mui/material';
import { IssuerType, UnsignedCredential, VerifiableCredential } from '@vckit/core-types';

const CredentialInfo = ({ credential }: { credential: VerifiableCredential | UnsignedCredential }) => {
  // The @vckit types predate VCDM 2.0 and do not declare validFrom.
  const { validFrom } = credential as { validFrom?: string };

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
      {/* moment(undefined) means "now": omit the row rather than invent a date (#855). */}
      {moment.utc(validFrom ?? NaN).isValid() && (
        <ListItem>
          <ListItemText primary='Valid from' secondary={moment.utc(validFrom).format('YYYY-MM-DD')} />
        </ListItem>
      )}
    </List>
  );
};

export default CredentialInfo;
