import { CredentialPayload, VerifiableCredential } from '@vckit/core-types';
import { contextDefault, typeDefault } from './models/vckit';
import { publicAPI } from './utils/httpService';

/**
 * integrate with vckit to issue vc with default context and type
 */
export const integrateVckitIssueVC = async ({
  context,
  type,
  issuer,
  credentialSubject,
  restOfVC,
}: CredentialPayload): Promise<VerifiableCredential> => {
  const body = constructCredentialObject({ context, type, issuer, credentialSubject, restOfVC });

  try {
    const response = await publicAPI.post(`${process.env.REACT_APP_VCKIT_API_URL ?? ''}/credentials/issue`, body);
    return response;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

const constructCredentialObject = ({ context, type, issuer, credentialSubject, restOfVC }: CredentialPayload) => {
  return {
    credential: {
      '@context': [...contextDefault, ...(context || [])],
      type: [...typeDefault, ...(type || [])],
      issuer: {
        id: issuer,
      },
      credentialSubject,
      ...restOfVC,
    },
  };
};
