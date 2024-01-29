import { CredentialPayload, VerifiableCredential } from '@vckit/core-types';
import { contextDefault, typeDefault } from './models/vckit';
import { publicAPI } from './utils/httpService';

export interface IVcKitIssueVC extends CredentialPayload {
  vcKitAPIUrl: string;
}

/**
 * integrate with vckit to issue vc with default context and type
 */
export const integrateVckitIssueVC = async ({
  context,
  type,
  issuer,
  credentialSubject,
  restOfVC,
  vcKitAPIUrl,
}: IVcKitIssueVC): Promise<VerifiableCredential> => {
  const body = constructCredentialObject({ context, type, issuer, credentialSubject, restOfVC });
  const response = await publicAPI.post(`${vcKitAPIUrl}/credentials/issue`, body);
  return response;
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
