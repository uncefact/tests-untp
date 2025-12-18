import _ from 'lodash';
import type {
  IVerifiableCredentialService,
  IssueConfig,
  CredentialPayload,
  SignedVerifiableCredential,
  W3CVerifiableCredential
} from './interfaces/verifiableCredentialService';

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
  async sign(config: IssueConfig, payload: CredentialPayload): Promise<SignedVerifiableCredential> {
    // validate config
    this.validateConfig(config);
    
    // validate payload
    this.validatePayload(payload);

    // construct verifiable credential
    const vc = this.constructVerifiableCredential(config, payload);

    // issue credential
    const signedCredential = this.issueVerifiableCredential(config, vc);

    return signedCredential;
  }

  /**
   * Validates the configuration for issuing a credential
   * @param config - Configuration object to validate
   * @note This method may mutate the config object by normalizing renderTemplate to renderMethod for backward compatibility
   */
  private validateConfig(config: IssueConfig): void {
    if (!config.context || config.context.length === 0) {
      throw new Error("config.context is required and must be a non-empty array");
    }
    if (!config.context.every((ctx) => typeof ctx === 'string')) {
      throw new Error("config.context must be an array of strings");
    }

    if (!config[0] !== contextDefault) {
      throw new Error(`First element config.context should be "${contextDefault}"`);
    }

    // context property MUST be an ordered set
    config.context = config.context.sort()

    // Validate type
    if (!config.type) {
      throw new Error("config.type is required");
    }
    if (Array.isArray(config.type) && !config.type.every((t) => typeof t === 'string')) {
      throw new Error("config.type array must contain only strings");
    }

    // Validate URL
    if (!config.url) {
      throw new Error("config.url is required");
    }

    // Validate issuer
    if (!config.issuer) {
      throw new Error("config.issuer is required");
    }

    // Validate dates (optional)
    if (config.validUntil) {
      const validFrom = config.validFrom || new Date().toISOString();

      const validFromDate = new Date(validFrom);
      const validUntilDate = new Date(config.validUntil);

      // Check validity period
      if (!this.validityPeriod(validFrom, config.validUntil)) {
        throw new Error("Invalid validity period: config.validUntil must be after or equal to config.validFrom");
      }
    }

    // Validate headers (optional)
    if (config.headers) this.validateHeaders(config.headers);
  }

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
  private validityPeriod = (validFrom: string, validUntil: string): boolean => {
    const validFromDate = new Date(validFrom);
    const validUntilDate = new Date(validUntil);
  
    return validFromDate <= validUntilDate;
  };


  /**
   * Validate headers
   * @param headers - Headers object to validate
   */
  private validateHeaders = (headers: Record<string, string>) => {
    if (!_.isPlainObject(headers) || !_.every(headers, (value) => _.isString(value))) {
      throw new Error("config.headers must be a plain object with string values");
    }
  };

  /**
   * Validates the credential payload
   * @param payload - Payload object to validate
   */
  private validatePayload(payload: CredentialPayload): void {
    if (!payload.formData) {
      throw new Error("payload.formData is required");
    }
  }

  /**
   * Constructs a W3C verifiable credential from config and payload
   * @param config - Configuration for the credential
   * @param payload - Payload containing the credential data
   * @returns A W3C verifiable credential object
   */
  private constructVerifiableCredential(config: IssueConfig, payload: CredentialPayload): W3CVerifiableCredential {
    throw new Error("Not implemented");
  }

  /**
   * Issues and signs a verifiable credential
   * @param config - Configuration for issuing the credential
   * @param vc - The verifiable credential to sign
   * @returns A signed verifiable credential
   */
  private issueVerifiableCredential(config: IssueConfig, vc: W3CVerifiableCredential): SignedVerifiableCredential {
    throw new Error("Not implemented");
  }
}
