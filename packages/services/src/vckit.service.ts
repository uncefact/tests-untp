import { CredentialPayload, CredentialSubject, VerifiableCredential } from '@vckit/core-types';
import { publicAPI } from './utils/httpService.js';

export const contextDefault = [
  'https://www.w3.org/2018/credentials/v1',
  'https://w3id.org/vc-revocation-list-2020/v1',
  'https://w3id.org/security/suites/jws-2020/v1',
  'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
  'https://w3id.org/security/suites/jws-2020/v1',
];

export const typeDefault = [];

export interface IArgIssueVC {
  credentialSubject: CredentialSubject;
  type?: string;
}
export interface IVcKitIssueVC extends CredentialPayload {
  vcKitAPIUrl: string;
}

/**
 * integrate with vckit to issue vc with default context and type
 * @param context - context for the vc
 * @param type - type for the vc
 * @param issuer - issuer for the vc
 * @param credentialSubject - credential subject for the vc
 * @param restOfVC - rest of the vc
 * @param vcKitAPIUrl - api url for the vc
 * @returns VerifiableCredential
 *
 * @example
 * const context = ['https://www.w3.org/2018/credentials/v1'];
 * const type = ['VerifiableCredential', 'Event'];
 * const issuer = 'did:example:123';
 * const credentialSubject = { id: 'did:example:123', name: 'John Doe' };
 * const restOfVC = { render: {}};
 * const vc = await integrateVckitIssueVC({ context, type, issuer, credentialSubject, restOfVC, vcKitAPIUrl });
 */
export const issueVC = async ({
  context,
  type,
  issuer,
  credentialSubject,
  restOfVC,
  vcKitAPIUrl,
}: IVcKitIssueVC): Promise<VerifiableCredential> => {
  const body = constructCredentialObject({ context, type, issuer, credentialSubject, restOfVC });
  const response = await publicAPI.post<VerifiableCredential>(`${vcKitAPIUrl}/credentials/issue`, body);
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
