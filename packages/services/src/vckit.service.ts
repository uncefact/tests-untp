import { CredentialPayload, CredentialSubject, VerifiableCredential, CredentialStatusReference } from '@vckit/core-types';
import { privateAPI } from './utils/httpService.js';
import appConfig from '../../mock-app/src/constants/app-config.json';

export const contextDefault = [
  'https://www.w3.org/2018/credentials/v1',
  'https://w3id.org/vc-revocation-list-2020/v1',
  'https://w3id.org/security/suites/jws-2020/v1',
  'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
  'https://w3id.org/security/suites/jws-2020/v1',
];

export const typeDefault = ['VerifiableCredential'];

export const PROOF_FORMAT = 'EnvelopingProofJose';

export interface IArgIssueVC {
  credentialSubject: CredentialSubject;
  type?: string;
}
export interface IVcKitIssueVC extends CredentialPayload {
  vcKitAPIUrl: string;
}

export interface IArgIssueCredentialStatus {
  host: string;
  statusPurpose?: string;

  [x: string]: any
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
  const apiKey = appConfig.defaultVerificationServiceLink.apiKey ?? '';

  // issue credential status
  const credentialStatus = await issueCredentialStatus({
    host: new URL(vcKitAPIUrl).origin,
    apiKey,
    statusPurpose: 'revocation',
    bitstringStatusIssuer: issuer,
  });

  // issue vc
  const body = constructCredentialObject({ context, type, issuer, credentialSubject, credentialStatus, ...restOfVC });
  privateAPI.setBearerTokenAuthorizationHeaders(apiKey);
  const response = await privateAPI.post<VerifiableCredential>(`${vcKitAPIUrl}/credentials/issue`, body);
  return response;
};

/**
 * Issue credential status for the vc
 * @param host - host for issuing the credential status
 * @param apiKey - api key for issuing the credential status
 * @param statusPurpose - purpose for the credential status
 * @param bitstringStatusIssuer - issuer for the credential status
 * @returns CredentialStatusReference
 * 
 * @example
 * const host = 'https://api.vc.example.com';
 * const apiKey = 'api-key';
 * const statusPurpose = 'revocation';
 * const bitstringStatusIssuer = 'did:example:123';
 * const credentialStatus = await issueCredentialStatus({ host, statusPurpose, bitstringStatusIssuer });
 */
export const issueCredentialStatus = async (args: IArgIssueCredentialStatus): Promise<CredentialStatusReference> => {
  const { host, apiKey, ...body } = args;
  privateAPI.setBearerTokenAuthorizationHeaders(apiKey);
  const response = await privateAPI.post<CredentialStatusReference>(`${host}/agent/issueBitstringStatusList`, body);
  return response;
};

const constructCredentialObject = ({ context, type, issuer, credentialSubject, ...restOfVC }: CredentialPayload) => {
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
    options: {
      proofFormat: PROOF_FORMAT,
    },
  };
};
