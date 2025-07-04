import {
  CredentialPayload,
  CredentialSubject,
  VerifiableCredential,
  CredentialStatusReference,
  IssuerType,
  IVerifyResult,
  UnsignedCredential,
} from '@vckit/core-types';
import { decodeJwt } from 'jose';
import { privateAPI } from './utils/httpService.js';
import _ from 'lodash';

export const contextDefault = ['https://www.w3.org/ns/credentials/v2'];

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
 * const restOfVC = { renderMethod: {}};
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
    _validateVckitHeaders(headers);
  }

  if (restOfVC?.validUntil) {
    const validUntil = restOfVC.validUntil;
    const validFrom = new Date().toISOString();

    try {
      if (!validityPeriod(validFrom, validUntil)) {
        throw new Error('Invalid validity period: validUntil must be after or equal to validFrom');
      }
    } catch (error) {
      throw new Error(`Invalid validUntil value: ${(error as Error).message}`);
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

  let issuerId = args.bitstringStatusIssuer;
  if (_.isPlainObject(args.bitstringStatusIssuer)) {
    if ((args.bitstringStatusIssuer as any).id) {
      issuerId = (args.bitstringStatusIssuer as any).id;
    } else {
      throw new Error('Error issuing credential status: Bitstring Status Issuer ID is required');
    }
  }

  const { host, headers, statusPurpose = 'revocation', ...rest } = args;
  const body = {
    statusPurpose,
    ...rest,
    bitstringStatusIssuer: issuerId,
  };

  if (headers) {
    _validateVckitHeaders(headers);
  }

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
      type: [...(type || []), ...typeDefault],
      issuer: issuer,
      credentialSubject,
      validFrom: new Date().toISOString(),
      ...restOfVC,
    },
    options: {
      proofFormat: PROOF_FORMAT,
    },
  };
};

/**
 * Integrate with vckit to verify VC
 * @param verifiableCredential
 * @param vcKitAPIUrl
 * @returns
 */
export const verifyVC = async (
  verifiableCredential: VerifiableCredential,
  vcKitAPIUrl?: string,
  headers?: Record<string, string>,
): Promise<IVerifyResult> => {
  const verifyCredentialParams = {
    credential: verifiableCredential,
    fetchRemoteContexts: true,
    policies: {
      credentialStatus: true,
    },
  };

  if (!vcKitAPIUrl) {
    throw new Error('Error verifying VC. VcKit API URL is required.');
  }

  if (headers) {
    _validateVckitHeaders(headers);
  }

  return await privateAPI.post<IVerifyResult>(vcKitAPIUrl, verifyCredentialParams, { headers: headers || {} });
};

/**
 * Decode enveloped VC
 * @param vc
 * @returns
 */
export const decodeEnvelopedVC = (vc: VerifiableCredential): UnsignedCredential | null => {
  try {
    if (vc?.type === 'EnvelopedVerifiableCredential') {
      const encodedCredential = vc?.id?.split(',')[1];
      return decodeJwt(encodedCredential as string) as UnsignedCredential;
    }
  } catch (error) {
    console.error('Error decoding enveloped VC.', error);
  }
  return null;
};

/**
 * Validate VcKit headers
 * @param headers
 */
const _validateVckitHeaders = (headers: Record<string, string>) => {
  if (!_.isPlainObject(headers) || !_.every(headers, (value) => _.isString(value))) {
    throw new Error('VcKit headers defined in app config must be a plain object with string values');
  }
};

/**
 * Validate the validity period of the credential
 * @param validFrom - The date-time stamp when the credential was issued
 * @param validUntil - The date-time stamp when the credential expires
 * @returns boolean
 *
 * @example
 * const validFrom = '2022-01-01T00:00:00Z';
 * const validUntil = '2022-01-01T00:00:00Z';
 * const isValid = validityPeriod(validFrom, validUntil);
 * console.log(isValid); // Output: true
 */
const validityPeriod = (validFrom: string, validUntil: string): boolean => {
  const validFromDate = new Date(validFrom);
  const validUntilDate = new Date(validUntil);

  return validFromDate <= validUntilDate;
};
