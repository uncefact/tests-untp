import { decodeJwt } from 'jose';
import {
  VC_CONTEXT_V2,
  VC_TYPE,
  VerificationErrorCode,
} from '../../interfaces/verifiableCredentialService.js';

import type {
  CredentialPayload,
  CredentialStatus,
  CredentialIssuer,
  UNTPVerifiableCredential,
  EnvelopedVerifiableCredential,
  IVerifiableCredentialService,
  VerifyResult
} from '../../interfaces/verifiableCredentialService.js';

/**
 * VCkit's IVerifyResult structure from the verification endpoint
 * @see https://github.com/uncefact/project-vckit/blob/main/packages/core-types/src/types/IVerifyResult.ts
 */
type VCkitVerifyResult = {
  verified: boolean;
  error?: {
    message?: string;
    errorCode?: string;
  };
  [x: string]: unknown;
};

const PROOF_FORMAT = 'EnvelopingProofJose';

/**
 * Maps VCkit errorCode strings to VerificationErrorCode enum values
 */
function mapErrorCode(errorCode?: string): VerificationErrorCode {
  if (!errorCode) {
    return VerificationErrorCode.Integrity;
  }

  const code = errorCode.toLowerCase();

  // Check for status/revocation errors
  if (code.includes('status') || code.includes('revoke')) {
    return VerificationErrorCode.Status;
  }

  // Check for integrity errors (signature, proof, etc.) before temporal
  // to avoid false matches like "signature_invalid" matching "valid"
  if (code.includes('signature') || code.includes('proof') || code.includes('integrity')) {
    return VerificationErrorCode.Integrity;
  }

  // Check for temporal errors (expiry, validity period)
  if (code.includes('expir') || code.includes('not_yet_valid') || code.includes('validfrom') || code.includes('validuntil')) {
    return VerificationErrorCode.Temporal;
  }

  return VerificationErrorCode.Integrity;
}

/**
 * Transforms VCkit's verification response to the VerifyResult interface
 */
function transformVerifyResult(vckitResult: VCkitVerifyResult): VerifyResult {
  if (vckitResult.verified) {
    return { verified: true };
  }

  return {
    verified: false,
    error: vckitResult.error ? {
      type: mapErrorCode(vckitResult.error.errorCode),
      message: vckitResult.error.message || 'Verification failed'
    } : undefined
  };
}

type IssueCredentialStatusParams = {
  host: string;
  headers?: Record<string, string>;
  bitstringStatusIssuer: CredentialIssuer | string;
  statusPurpose?: 'revocation';
};

/**
 * Service implementation for issuing verifiable credentials
 * Implements the IVerifiableCredentialService interface
 */
export class VerifiableCredentialService implements IVerifiableCredentialService {
  readonly baseURL: string;
  readonly defaultHeaders: Record<string, string>;

  /**
   * Constructs a new VerifiableCredentialService instance
   * @param baseURL - The base URL for the credential service API
   */
  constructor(baseURL: string, defaultHeaders: Record<string, string>) {
    if (!baseURL) {
      throw new Error("Error creating VerifiableCredentialService. API URL is required.");
    }
    if (!defaultHeaders?.Authorization) {
      throw new Error("Error creating VerifiableCredentialService. Authorization header is required.");
    }
    this.baseURL = baseURL;
    this.defaultHeaders = defaultHeaders;
  }

  /**
   * Issues a verifiable credential by signing the provided payload
   * @param payload - The credential payload containing form data
   * @param headers - Optional HTTP headers to include in the request
   * @returns A promise that resolves to a signed verifiable credential
   */
  async sign(
    credentialPayload: CredentialPayload,
  ): Promise<EnvelopedVerifiableCredential> {
    // A verifiable credential MUST contain a credentialSubject property
    if (!credentialPayload.credentialSubject ||
        (typeof credentialPayload.credentialSubject === 'object' &&
         Object.keys(credentialPayload.credentialSubject).length === 0)) {
      throw new Error("Error issuing VC. credentialSubject is required in credential payload.");
    }

    // Issue credential status if not provided
    const credentialStatus = await this.issueCredentialStatus({
      host: new URL(this.baseURL).origin,
      headers: this.defaultHeaders,
      bitstringStatusIssuer: credentialPayload.issuer,
    });

    // construct verifiable credential
    const vc = this.constructVerifiableCredential({
      ...credentialPayload,
      credentialStatus
    });

    // issue credential
    return this.issueVerifiableCredential(vc);
  }

  /**
   * Verifies an enveloped verifiable credential
   * @param credential - The enveloped verifiable credential to verify
   * @returns A promise that resolves to a verification result
   */
  public async verify(credential: EnvelopedVerifiableCredential): Promise<VerifyResult> {
    if (!credential) {
      throw new Error('Error verifying VC. Credential is required.');
    }

    const verifyCredentialParams = {
      credential: credential,
      fetchRemoteContexts: true,
      policies: {
        credentialStatus: true,
      },
    };

    try {
      const response = await fetch(`${this.baseURL}/credentials/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.defaultHeaders || {})
        },
        body: JSON.stringify(verifyCredentialParams)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const vckitResult = await response.json() as VCkitVerifyResult;
      return transformVerifyResult(vckitResult);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to verify verifiable credential: ${error.message}`);
      }
      throw new Error('Failed to verify verifiable credential: Unknown error');
    }
  }

  /**
   * Decodes an enveloped verifiable credential to extract the unsigned credential content
   * @param credential - The enveloped verifiable credential to decode
   * @returns A promise that resolves to the decoded credential.
   */
  public async decode(credential: EnvelopedVerifiableCredential): Promise<UNTPVerifiableCredential> {
    if (!credential) {
      throw new Error('Error decoding VC. Credential is required.');
    }

    try {
      if (credential.type === 'EnvelopedVerifiableCredential') {
        const encodedCredential = credential.id?.split(',')[1];
        if (!encodedCredential) {
          throw new Error('Invalid enveloped credential format: missing encoded data');
        }
        return decodeJwt(encodedCredential) as UNTPVerifiableCredential;
      }
      throw new Error('Credential is not an EnvelopedVerifiableCredential');
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to decode verifiable credential: ${error.message}`);
      }
      throw new Error('Failed to decode verifiable credential: Unknown error');
    }
  }

  private constructVerifiableCredential(
    credentialPayload: CredentialPayload & { credentialStatus: CredentialStatus }
  ): UNTPVerifiableCredential {
    // add or merge context from credentialPayload
    const context = [...new Set([VC_CONTEXT_V2, ...(credentialPayload['@context'] || [])])]
    const type = [...new Set([VC_TYPE, ...(credentialPayload.type || [])])];

    const issuer = credentialPayload.issuer;

    const vc = {
      ...credentialPayload,
      "@context": context,
      type: type,
      issuer: issuer
    } as UNTPVerifiableCredential

    return vc;
  }

  /**
   * Issues and signs a verifiable credential by calling VCkit API
   * @param vc - The verifiable credential to sign
   * @returns An enveloped verifiable credential
   */
  private async issueVerifiableCredential(
    vc: UNTPVerifiableCredential
  ): Promise<EnvelopedVerifiableCredential> {
    const payload = {
      credential: vc,
      options: {
        proofFormat: PROOF_FORMAT,
      }
    };

    try {
      const response = await fetch(`${this.baseURL}/credentials/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.defaultHeaders
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json() as { verifiableCredential: EnvelopedVerifiableCredential };
      return result.verifiableCredential;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to issue verifiable credential: ${error.message}`);
      }
      throw new Error('Failed to issue verifiable credential: Unknown error');
    }
  }

  /**
   * Issues a credential status for bitstring status list
   * @param params - Parameters for issuing credential status
   * @returns A promise that resolves to a credential status object
   * @throws Error if required parameters are missing or invalid
   */
  private async issueCredentialStatus(
    params: IssueCredentialStatusParams
  ): Promise<CredentialStatus> {
    if (!params.host) {
      throw new Error('Error issuing credential status: Host is required');
    }

    if (!params.bitstringStatusIssuer) {
      throw new Error('Error issuing credential status: Bitstring Status Issuer is required');
    }

    // issuer can be either a string or an object
    let issuerId: string;
    if (typeof params.bitstringStatusIssuer === 'string') {
      issuerId = params.bitstringStatusIssuer;
    } else if (typeof params.bitstringStatusIssuer === 'object' && params.bitstringStatusIssuer.id) {
      issuerId = params.bitstringStatusIssuer.id;
    } else {
      throw new Error('Error issuing credential status: Bitstring Status Issuer ID is required');
    }

    const { host, headers, statusPurpose = 'revocation', ...rest } = params;
    const payload = {
      statusPurpose,
      ...rest,
      bitstringStatusIssuer: issuerId,
    };

    try {
      const response = await fetch(`${host}/agent/issueBitstringStatusList`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers || {})
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as CredentialStatus;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to issue credential status: ${error.message}`);
      }
      throw new Error('Failed to issue credential status: Unknown error');
    }
  }
}
