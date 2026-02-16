import { decodeJwt } from 'jose';
import type { IVerifyResult } from '@vckit/core-types';
import { BaseServiceAdapter } from '../../../registry/base-adapter.js';
import type { LoggerService } from '../../../logging/types.js';
import type { AdapterRegistryEntry } from '../../../registry/types.js';
import type {
  IVerifiableCredentialService,
  CredentialPayload,
  CredentialStatus,
  CredentialIssuer,
  UNTPVerifiableCredential,
  EnvelopedVerifiableCredential,
  VerifyResult,
} from '../../types.js';
import { VC_CONTEXT_V2, VC_TYPE, VerificationErrorCode } from '../../types.js';
import { VcSignError, VcVerifyError, VcDecodeError, VcCredentialStatusError } from '../../errors.js';
import type { VCKitVerifiableCredentialConfig } from './vckit-verifiable-credential.schema.js';
import {
  vckitVerifiableCredentialConfigSchema,
  vckitVerifiableCredentialSensitiveFields,
} from './vckit-verifiable-credential.schema.js';

const PROOF_FORMAT = 'EnvelopingProofJose';

export const VCKIT_VC_ADAPTER_TYPE = 'VCKIT' as const;

function mapErrorCode(errorCode?: string): VerificationErrorCode {
  if (!errorCode) return VerificationErrorCode.Integrity;
  const code = errorCode.toLowerCase();
  if (code.includes('status') || code.includes('revoke')) return VerificationErrorCode.Status;
  if (code.includes('signature') || code.includes('proof') || code.includes('integrity'))
    return VerificationErrorCode.Integrity;
  if (
    code.includes('expir') ||
    code.includes('not_yet_valid') ||
    code.includes('validfrom') ||
    code.includes('validuntil')
  )
    return VerificationErrorCode.Temporal;
  return VerificationErrorCode.Integrity;
}

function transformVerifyResult(vckitResult: IVerifyResult): VerifyResult {
  if (vckitResult.verified) return { verified: true };
  return {
    verified: false,
    error: vckitResult.error
      ? {
          type: mapErrorCode(vckitResult.error.errorCode),
          message: vckitResult.error.message || 'Verification failed',
        }
      : undefined,
  };
}

export class VCKitVerifiableCredentialService extends BaseServiceAdapter implements IVerifiableCredentialService {
  private readonly baseURL: string;
  private readonly headers: Record<string, string>;

  constructor(config: VCKitVerifiableCredentialConfig, logger: LoggerService) {
    super(logger.child({ service: 'VC - VCKitVerifiableCredential' }));
    this.baseURL = config.endpoint;
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
  }

  async sign(credentialPayload: CredentialPayload): Promise<EnvelopedVerifiableCredential> {
    if (
      !credentialPayload.credentialSubject ||
      (typeof credentialPayload.credentialSubject === 'object' &&
        !Array.isArray(credentialPayload.credentialSubject) &&
        Object.keys(credentialPayload.credentialSubject).length === 0)
    ) {
      throw new VcSignError('credentialSubject is required in credential payload');
    }

    this.logger.debug('Issuing credential status');
    const credentialStatus = await this.issueCredentialStatus(credentialPayload.issuer);

    const vc = this.constructVerifiableCredential({ ...credentialPayload, credentialStatus });

    this.logger.debug('Issuing verifiable credential');
    return this.issueVerifiableCredential(vc);
  }

  async verify(credential: EnvelopedVerifiableCredential): Promise<VerifyResult> {
    if (!credential) throw new VcVerifyError('Credential is required');

    const verifyParams = {
      credential,
      fetchRemoteContexts: true,
      policies: { credentialStatus: true },
    };

    this.logger.debug('Verifying credential');
    const response = await fetch(`${this.baseURL}/credentials/verify`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(verifyParams),
    });

    if (!response.ok) {
      const detail = `HTTP ${response.status}: ${response.statusText}`;
      this.logger.error({ httpStatus: response.status }, 'Verification API request failed');
      throw new VcVerifyError(detail, response.status);
    }

    const vckitResult = (await response.json()) as IVerifyResult;
    const result = transformVerifyResult(vckitResult);
    this.logger.info({ verified: result.verified }, 'Credential verification complete');
    return result;
  }

  async decode(credential: EnvelopedVerifiableCredential): Promise<UNTPVerifiableCredential> {
    if (!credential) throw new VcDecodeError('Credential is required');

    if (credential.type !== 'EnvelopedVerifiableCredential') {
      throw new VcDecodeError('Credential is not an EnvelopedVerifiableCredential');
    }

    const encodedCredential = credential.id?.split(',')[1];
    if (!encodedCredential) {
      throw new VcDecodeError('Invalid enveloped credential format: missing encoded data');
    }

    try {
      return decodeJwt(encodedCredential) as UNTPVerifiableCredential;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      throw new VcDecodeError(detail);
    }
  }

  // -- Private helpers ----------------------------------------------------

  private constructVerifiableCredential(
    payload: CredentialPayload & { credentialStatus: CredentialStatus },
  ): UNTPVerifiableCredential {
    const context = [...new Set([VC_CONTEXT_V2, ...(payload['@context'] || [])])];
    const type = [...new Set([VC_TYPE, ...(payload.type || [])])];
    return { ...payload, '@context': context, type } as UNTPVerifiableCredential;
  }

  private async issueVerifiableCredential(vc: UNTPVerifiableCredential): Promise<EnvelopedVerifiableCredential> {
    const response = await fetch(`${this.baseURL}/credentials/issue`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ credential: vc, options: { proofFormat: PROOF_FORMAT } }),
    });

    if (!response.ok) {
      const detail = `HTTP ${response.status}: ${response.statusText}`;
      this.logger.error({ httpStatus: response.status }, 'Issue API request failed');
      throw new VcSignError(detail, response.status);
    }

    const result = (await response.json()) as { verifiableCredential: EnvelopedVerifiableCredential };
    this.logger.info('Credential issued successfully');
    return result.verifiableCredential;
  }

  private async issueCredentialStatus(issuer: CredentialIssuer | string): Promise<CredentialStatus> {
    const issuerId = typeof issuer === 'string' ? issuer : issuer?.id;
    if (!issuerId) throw new VcCredentialStatusError('Issuer ID is required');

    const host = new URL(this.baseURL).origin;
    const response = await fetch(`${host}/agent/issueBitstringStatusList`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ statusPurpose: 'revocation', bitstringStatusIssuer: issuerId }),
    });

    if (!response.ok) {
      const detail = `HTTP ${response.status}: ${response.statusText}`;
      this.logger.error({ httpStatus: response.status }, 'Credential status API request failed');
      throw new VcCredentialStatusError(detail, response.status);
    }

    return (await response.json()) as CredentialStatus;
  }
}

export const vckitVerifiableCredentialRegistryEntry = {
  configSchema: vckitVerifiableCredentialConfigSchema,
  sensitiveFields: vckitVerifiableCredentialSensitiveFields,
  factory: (config: VCKitVerifiableCredentialConfig, logger: LoggerService): IVerifiableCredentialService =>
    new VCKitVerifiableCredentialService(config, logger),
} satisfies AdapterRegistryEntry<VCKitVerifiableCredentialConfig, IVerifiableCredentialService>;
