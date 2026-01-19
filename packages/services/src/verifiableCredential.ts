import _ from 'lodash';
import { decodeJwt } from 'jose';
import type {
  CredentialPayload,
  CredentialStatus,
  DecodedVerifiableCredential,
  EnvelopedVerifiableCredential,
  IVerifiableCredentialService,
  Issuer,
  IssueCredentialStatusParams,
  SignedVerifiableCredential,
  VerifyResult,
  W3CVerifiableCredential
} from './interfaces/verifiableCredentialService';

import { privateAPI } from './utils/httpService.js';


export const contextDefault = ['https://www.w3.org/ns/credentials/v2'];
export const typeDefault = ['VerifiableCredential'];
export const issuerDefault = 'did:web:uncefact.github.io:project-vckit:test-and-development';
export const PROOF_FORMAT = 'EnvelopingProofJose';

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
  constructor(baseURL: string, defaultHeaders?: Record<string, string>) {
    if (!baseURL) {
      throw new Error("Error creating VerifiableCredentialService. API URL is required.");
    }
    this.baseURL = baseURL;
    this.defaultHeaders = defaultHeaders || {};
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
    const credentialStatus = credentialPayload.credentialStatus ?? await this.issueCredentialStatus({
      host: new URL(this.baseURL).origin,
      headers: this.defaultHeaders,
      bitstringStatusIssuer: credentialPayload.issuer || issuerDefault,
    });

    // construct verifiable credential
    const vc = this.constructVerifiableCredential({
      ...credentialPayload,
      credentialStatus
    });

    // issue credential
    const signedCredential = await this.issueVerifiableCredential(vc);

    return signedCredential.verifiableCredential as EnvelopedVerifiableCredential;
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
      const result = await privateAPI.post<VerifyResult>(
        `${this.baseURL}/credentials/verify`,
        verifyCredentialParams,
        { headers: this.defaultHeaders || {} }
      );
      return result;
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
   * @returns A promise that resolves to the decoded credential without the proof
   */
  public async decode(credential: EnvelopedVerifiableCredential): Promise<DecodedVerifiableCredential> {
    if (!credential) {
      throw new Error('Error decoding VC. Credential is required.');
    }

    try {
      if (credential.type === 'EnvelopedVerifiableCredential') {
        const encodedCredential = credential.id?.split(',')[1];
        if (!encodedCredential) {
          throw new Error('Invalid enveloped credential format: missing encoded data');
        }
        return decodeJwt(encodedCredential) as DecodedVerifiableCredential;
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
    credentialPayload: CredentialPayload
  ): W3CVerifiableCredential {
    // add or merge context from credentialPayload
    const context = [...new Set([...contextDefault, ...(credentialPayload.context || [])])]
    const additionalTypes = credentialPayload.type
      ? (Array.isArray(credentialPayload.type) ? credentialPayload.type : [credentialPayload.type])
      : [];

    const type = [...typeDefault, ...additionalTypes];

    const issuer = credentialPayload.issuer || issuerDefault;

    const vc = {
      ...credentialPayload,
      "@context": context,
      type: type,
      issuer: issuer
    } as W3CVerifiableCredential

    return vc;
  }

  /**
   * Issues and signs a verifiable credential by calling VCkit API
   * @param vc - The verifiable credential to sign
   * @returns A signed verifiable credential
   */
  private async issueVerifiableCredential(
    vc: W3CVerifiableCredential
  ): Promise<SignedVerifiableCredential> {
    const payload = {
      credential: vc
    };

    try {
      const verifiableCredential = await privateAPI.post<SignedVerifiableCredential>(
        `${this.baseURL}/credentials/issue`,
        payload,
        { headers: this.defaultHeaders },
      );
      return verifiableCredential;
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
      const response = await privateAPI.post<CredentialStatus>(
        `${host}/agent/issueBitstringStatusList`,
        payload,
        { headers: headers || {} }
      );
      return response;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to issue credential status: ${error.message}`);
      }
      throw new Error('Failed to issue credential status: Unknown error');
    }
  }
}
