import _ from 'lodash';
import type {
  CredentialPayload,
  IVerifiableCredentialService,
  SignedVerifiableCredential,
  VerifyResult,
  W3CVerifiableCredential
} from './interfaces/verifiableCredentialService';

import { privateAPI } from './utils/httpService.js';

export const contextDefault = ['https://www.w3.org/ns/credentials/v2'];
export const typeDefault = ['VerifiableCredential'];
export const issuerDefault = 'did:web:uncefact.github.io:project-vckit:test-and-development';

/**
 * Service implementation for issuing verifiable credentials
 * Implements the IVerifiableCredentialService interface
 */
export class VerifiableCredentialService implements IVerifiableCredentialService {
  /**
   * Base URL for the credential service API
   */
  public readonly baseURL: string;

  /**
   * Constructs a new VerifiableCredentialService instance
   * @param baseURL - The base URL for the credential service API
   */
  constructor(baseURL: string) {
    if (!baseURL) {
      throw new Error("Error creating VerifiableCredentialService. API URL is required.");
    }
    this.baseURL = baseURL;
  }

  /**
   * Issues a verifiable credential by signing the provided payload
   * @param payload - The credential payload containing form data
   * @param headers - Optional HTTP headers to include in the request
   * @returns A promise that resolves to a signed verifiable credential
   */
  async sign(
    credentialPayload: CredentialPayload,
    headers?: Record<string, string>
  ): Promise<SignedVerifiableCredential> {
    // A verifiable credential MUST contain a credentialSubject property
    if (!credentialPayload.credentialSubject ||
        (typeof credentialPayload.credentialSubject === 'object' &&
         Object.keys(credentialPayload.credentialSubject).length === 0)) {
      throw new Error("Error issuing VC. credentialSubject is required in credential payload.");
    }

    // construct verifiable credential
    const vc = this.constructVerifiableCredential(credentialPayload);

    // issue credential
    const signedCredential = await this.issueVerifiableCredential(vc, headers);

    return signedCredential;
  }

  private validateHeaders(headers: Record<string, string>) {
    if (!_.isPlainObject(headers) || !_.every(headers, (value) => _.isString(value))) {
      throw new Error("Headers must be a plain object with string values");
    }
  }

  private constructVerifiableCredential(
    credentialPayload: CredentialPayload
  ): W3CVerifiableCredential {
    // add or merge context from credentialPayload
    const context = [...contextDefault, ...(credentialPayload.context || [])]
    const type = [...(credentialPayload.type || []), ...typeDefault];

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
   * @param headers - Optional HTTP headers to include in the request
   * @returns A signed verifiable credential
   */
  private async issueVerifiableCredential(
    vc: W3CVerifiableCredential,
    headers?: Record<string, string>
  ): Promise<SignedVerifiableCredential> {
    if (headers) {
      this.validateHeaders(headers);
    }

    const payload = {
      credential: vc
    };

    try {
      const verifiableCredential = await privateAPI.post<SignedVerifiableCredential>(
        `${this.baseURL}/credentials/issue`,
        payload,
        { headers: headers || {} },
      );
      return verifiableCredential;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to issue verifiable credential: ${error.message}`);
      }
      throw new Error('Failed to issue verifiable credential: Unknown error');
    }
  }
}
