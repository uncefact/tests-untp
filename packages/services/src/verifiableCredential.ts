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
   * Issues a verifiable credential by signing the provided payload     
   * @param config - Configuration for issuing the credential           
   * @param payload - The credential payload containing form data       
   * @returns A promise that resolves to a signed verifiable credential 
   */ 
  async sign(
    baseURL: string,
    credentialPayload: CredentialPayload,
    headers?: Record<string, string>
  ): Promise<SignedVerifiableCredential> {
    if (!baseURL) {
      throw new Error("Error issuing VC. API URL is required.");
    }

    // A verifiable credential MUST contain a credentialSubject property
    if (!credentialPayload.credentialSubject || 
        (typeof credentialPayload.credentialSubject === 'object' && 
         Object.keys(credentialPayload.credentialSubject).length === 0)) {
      throw new Error("Error issuing VC. credentialSubject is required in credential payload.");
    }

    // construct verifiable credential
    const vc = this.constructVerifiableCredential(credentialPayload);

    const result = await this.validateVerifiableCredential(baseURL, vc, headers);

    // Check validation result before issuing
    if (!result.verified) {
      const errorMessage = result.error?.message || 'Credential validation failed';
      throw new Error(`Error issuing VC. Validation failed: ${errorMessage}`);
    }

    // issue credential
    const signedCredential = await this.issueVerifiableCredential(baseURL, vc, headers);

    return signedCredential;
  }

  private async validateVerifiableCredential(
    baseURL: string,
    vc: W3CVerifiableCredential,
    headers?: Record<string, string>
  ): Promise<VerifyResult> {
    const verifyCredentialPayload = {
      credential: vc,
      fetchRemoteContexts: true,
      policies: {
        credentialStatus: true,
      },
    }

    if (!baseURL) {
      throw new Error("Error verifying VC. API URL is required.");
    }

    if (headers) {
      this.validateHeaders(headers);
    }

    try {
      return await privateAPI.post<VerifyResult>(baseURL, verifyCredentialPayload, { headers: headers || {} });
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to validate verifiable credential: ${error.message}`);
      }
      throw new Error('Failed to validate verifiable credential: Unknown error');
    }
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
   * @param config - Configuration for issuing the credential
   * @param vc - The verifiable credential to sign
   * @returns A signed verifiable credential
   */
  private async issueVerifiableCredential(
    baseURL: string,
    vc: W3CVerifiableCredential,
    headers?: Record<string, string>
  ): Promise<SignedVerifiableCredential> {
    if (headers) {
      this.validateHeaders(headers);
    }

    try {
      const verifiableCredential = await privateAPI.post<SignedVerifiableCredential>(
        `${baseURL}/credentials/issue`,
        vc,
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
