'use client';

import { useMemo } from 'react';
import moment from 'moment';
import { List, ListItem, ListItemText } from '@mui/material';
import { IssuerType, UnsignedCredential, VerifiableCredential } from '@vckit/core-types';

const CredentialInfo = ({ credential }: { credential: VerifiableCredential | UnsignedCredential }) => {
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
      {/* ISO 8601 in UTC for an international audience: MM/DD vs DD/MM is
          ambiguous, and a viewer-local date can differ between reviewers of
          the same credential (#855). The row is omitted entirely when the
          credential carries no parseable issuanceDate (VC data model v2 uses
          validFrom/validUntil instead): moment(undefined) means "now", which
          would fabricate an issue date the credential never stated. */}
      {moment.utc(credential.issuanceDate ?? NaN).isValid() && (
        <ListItem>
          <ListItemText primary='Issue date' secondary={moment.utc(credential.issuanceDate).format('YYYY-MM-DD')} />
        </ListItem>
      )}
    </List>
  );
};

export default CredentialInfo;
