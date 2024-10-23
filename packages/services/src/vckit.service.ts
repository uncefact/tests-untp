import {
  CredentialPayload,
  CredentialSubject,
  VerifiableCredential,
  CredentialStatusReference,
  IssuerType,
} from '@vckit/core-types';
import { privateAPI } from './utils/httpService.js';
import appConfig from '../../mock-app/src/constants/app-config.json' assert { type: 'json' };

export const contextDefault = [
  'https://www.w3.org/ns/credentials/v2',
  'https://www.w3.org/ns/credentials/examples/v2',
  'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
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
  apiKey: string;
  bitstringStatusIssuer: IssuerType;
  statusPurpose?: string;

  [x: string]: any;
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
 * const credentialStatus = { "id": "http://example.com/bitstring-status-list/25#0", "type": "BitstringStatusListEntry", "statusPurpose": "revocation", "statusListIndex": 0, "statusListCredential": "http://example.com/bitstring-status-list/25" }
 * const restOfVC = { render: {}};
 * const vc = await integrateVckitIssueVC({ context, type, issuer, credentialSubject, restOfVC, vcKitAPIUrl });
 */
export const issueVC = async ({
  context,
  type,
  issuer,
  credentialSubject,
  credentialStatus,
  restOfVC,
  vcKitAPIUrl,
}: IVcKitIssueVC): Promise<VerifiableCredential> => {
  const apiKey = appConfig.defaultVerificationServiceLink.apiKey ?? '';
  let _credentialStatus = credentialStatus ? { ...credentialStatus } : null;

  // issue credential status if not provided
  if (!_credentialStatus) {
    // issue credential status
    _credentialStatus = await issueCredentialStatus({
      host: new URL(vcKitAPIUrl).origin, // example: https://api.vc.example.com
      apiKey,
      bitstringStatusIssuer: issuer,
    });
  }

  // issue vc
  const body = constructCredentialObject({ context, type, issuer, credentialSubject, credentialStatus: _credentialStatus, ...restOfVC });
  privateAPI.setBearerTokenAuthorizationHeaders(apiKey);
  const { verifiableCredential } = await privateAPI.post<VerifiableCredential>(
    `${vcKitAPIUrl}/credentials/issue`,
    body,
  );
  return verifiableCredential;
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
  if (!args.host) {
    throw new Error('Error issuing credential status: Host is required');
  }
  if (!args.apiKey) {
    throw new Error('Error issuing credential status: API Key is required');
  }
  if (!args.bitstringStatusIssuer) {
    throw new Error('Error issuing credential status: Bitstring Status Issuer is required');
  }

  const { host, apiKey, statusPurpose = 'revocation', ...rest } = args;
  const body = { statusPurpose, ...rest };

  // issue credential status
  privateAPI.setBearerTokenAuthorizationHeaders(apiKey);
  const response = await privateAPI.post<CredentialStatusReference>(`${host}/agent/issueBitstringStatusList`, body);
  return response;
};

const constructCredentialObject = ({ context, type, issuer, credentialSubject, ...restOfVC }: CredentialPayload) => {
  return {
    credential: {
      '@context': [...contextDefault, ...(context || [])],
      type: [...typeDefault, ...(type || [])],
      issuer: issuer,
      credentialSubject,
      ...restOfVC,
    },
    options: {
      proofFormat: PROOF_FORMAT,
    },
  };
};
