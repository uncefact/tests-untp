import {
  CredentialPayload,
  CredentialSubject,
  VerifiableCredential,
  CredentialStatusReference,
  IssuerType,
} from '@vckit/core-types';
import { privateAPI } from './utils/httpService.js';
import { isPlainObject, every, isString } from 'lodash';

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
  headers?: Record<string, string>;
}

export interface IArgIssueCredentialStatus {
  host: string;
  headers?: Record<string, string>;
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
 * @param headers - headers for the request
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
  headers,
}: IVcKitIssueVC): Promise<VerifiableCredential> => {
  let _credentialStatus = credentialStatus ? { ...credentialStatus } : null;

  if (headers) {
    if (!isPlainObject(headers) || !every(headers, isString)) {
      throw new Error('VcKit headers defined in app config must be a plain object with string values');
    }
  }

  // issue credential status if not provided
  if (!_credentialStatus) {
    // issue credential status
    _credentialStatus = await issueCredentialStatus({
      host: new URL(vcKitAPIUrl).origin, // example: https://api.vc.example.com
      headers,
      bitstringStatusIssuer: issuer,
    });
  }

  // issue vc
  const body = constructCredentialObject({
    context,
    type,
    issuer,
    credentialSubject,
    credentialStatus: _credentialStatus,
    ...restOfVC,
  });

  const { verifiableCredential } = await privateAPI.post<VerifiableCredential>(
    `${vcKitAPIUrl}/credentials/issue`,
    body,
    { headers: headers || {} },
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

  if (!args.bitstringStatusIssuer) {
    throw new Error('Error issuing credential status: Bitstring Status Issuer is required');
  }

  const { host, headers, statusPurpose = 'revocation', ...rest } = args;
  const body = { statusPurpose, ...rest };

  // issue credential status
  const response = await privateAPI.post<CredentialStatusReference>(`${host}/agent/issueBitstringStatusList`, body, {
    headers: headers || {},
  });
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
