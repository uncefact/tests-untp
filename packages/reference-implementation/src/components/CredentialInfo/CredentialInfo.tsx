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
      {/* UNTP credentials follow the W3C VC data model 2.0, whose temporal
          property is validFrom; the VCDM 1.1 issuanceDate the previous code
          read never exists on them, and moment(undefined) means "now", which
          fabricated today's date as an issue date (#855). Rendered as the
          UTC calendar date in ISO 8601: MM/DD vs DD/MM is ambiguous, and a
          viewer-local date can differ between reviewers of the same
          credential. The row is omitted when validFrom is absent or
          unparseable, rather than inventing a value. */}
      {moment.utc(validFrom ?? NaN).isValid() && (
        <ListItem>
          <ListItemText primary='Valid from' secondary={moment.utc(validFrom).format('YYYY-MM-DD')} />
        </ListItem>
      )}
    </List>
  );
};

export default CredentialInfo;
