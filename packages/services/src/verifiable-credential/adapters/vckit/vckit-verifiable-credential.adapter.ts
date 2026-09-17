import { httpFetch } from '../../../http/client.js';
import type { IVerifyResult } from '@vckit/core-types';
import { BaseServiceAdapter } from '../../../registry/base-adapter.js';
import type { LoggerService } from '../../../logging/types.js';
import type { AdapterRegistryEntry } from '../../../registry/types.js';
import type {
  IVerifiableCredentialService,
  CredentialPayload,
  CredentialStatus,
  CredentialStatusEntry,
  CanonicalCredentialStatusEntry,
  CredentialIssuer,
  UNTPVerifiableCredential,
  EnvelopedVerifiableCredential,
  VerifyResult,
  VerifyOptions,
  SignOptions,
  SetCredentialStatusInput,
  GetCredentialStatusInput,
  CredentialStatusObservation,
} from '../../types.js';
import { VC_CONTEXT_V2, VC_TYPE, VerificationErrorCode } from '../../types.js';
import {
  VcSignError,
  VcVerifyError,
  VcCredentialStatusError,
  VcStatusEntryUnsupportedError,
  VcStatusListNotFoundError,
  VcStatusReadError,
  VcStatusResponseInvalidError,
  VcStatusSetError,
} from '../../errors.js';
import { checkValidityWindow } from '../../common/validity-window.js';
import { canonicalStatusListIndex, parseCredentialStatusEntry } from '../../common/credential-status.js';
import { generateCurrentDatetime } from '../../../utils/helpers.js';
import type { VCKitVerifiableCredentialConfig } from './vckit-verifiable-credential.schema.js';
import {
  vckitVerifiableCredentialConfigSchema,
  vckitVerifiableCredentialSensitiveFields,
} from './vckit-verifiable-credential.schema.js';

const PROOF_FORMAT = 'EnvelopingProofJose';
const DEFAULT_STATUS_PURPOSES = ['revocation'] as const;

type IssuedCredentialStatusEntry = Omit<CredentialStatusEntry, 'statusListIndex'> & {
  statusListIndex: number;
};

type IssuedCredentialStatus = IssuedCredentialStatusEntry | IssuedCredentialStatusEntry[];

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

/**
 * Accepts only a response body whose `verified` field is a real boolean.
 *
 * VCKit's verify endpoint reports the outcome in `verified`. A truthiness
 * check would treat any malformed body (for example `{"verified":"false"}`)
 * as a successful verification, so anything other than a JSON object with a
 * boolean `verified` is rejected as a VcVerifyError.
 */
function parseVerifyResponse(body: unknown): IVerifyResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new VcVerifyError('Verification API returned a non-object response body');
  }
  const { verified } = body as { verified?: unknown };
  if (typeof verified !== 'boolean') {
    throw new VcVerifyError(`Verification API returned a non-boolean "verified" value: ${JSON.stringify(verified)}`);
  }
  return body as IVerifyResult;
}

function transformVerifyResult(vckitResult: IVerifyResult): VerifyResult {
  if (vckitResult.verified === true) return { verified: true };
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

function validateStatusIssuer(value: CredentialIssuer | string, errorType: 'credential-status' | 'input'): string {
  const issuerId =
    typeof value === 'string'
      ? value
      : typeof value === 'object' && value !== null
        ? (value as { id?: unknown }).id
        : undefined;
  if (typeof issuerId !== 'string' || issuerId.length === 0 || issuerId.trim() !== issuerId) {
    if (errorType === 'credential-status') throw new VcCredentialStatusError('Issuer ID is required');
    throw new VcStatusEntryUnsupportedError('Status list issuer must be a non-empty string', 'input');
  }
  return issuerId;
}

function statusPurposes(value: unknown): string[] {
  const rawPurposes =
    value === undefined
      ? [...DEFAULT_STATUS_PURPOSES]
      : Array.isArray(value)
        ? [...value]
        : (() => {
            throw new VcStatusEntryUnsupportedError('Status purposes must be an array', 'purpose');
          })();
  if (rawPurposes.length === 0) {
    return [];
  }

  const purposes: string[] = [];
  const seen = new Set<string>();
  for (const purpose of rawPurposes) {
    if (typeof purpose !== 'string' || purpose.trim().length === 0) {
      throw new VcStatusEntryUnsupportedError('Status purposes must be non-empty strings', 'purpose');
    }
    if (seen.has(purpose)) {
      throw new VcStatusEntryUnsupportedError(`Status purpose "${purpose}" was requested more than once`, 'purpose');
    }
    seen.add(purpose);
    purposes.push(purpose);
  }
  return purposes;
}

function responseBodyDetail(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'object' && record.error !== null && !Array.isArray(record.error)) {
      const nestedMessage = (record.error as Record<string, unknown>).message;
      if (typeof nestedMessage === 'string' && nestedMessage.length > 0) return nestedMessage;
    }
    for (const key of ['error', 'message', 'detail']) {
      if (typeof record[key] === 'string' && record[key].length > 0) return record[key];
    }
  }
  return fallback;
}

async function readResponseDetail(response: Response): Promise<string> {
  try {
    return responseBodyDetail(await response.json(), `HTTP ${response.status}: ${response.statusText}`);
  } catch {
    return `HTTP ${response.status}: ${response.statusText}`;
  }
}

/**
 * VCKit 1.2.1 takes `statusListIndex` as a JSON number on its status routes
 * and rejects a string. The canonical entry keeps the string the specification
 * defines, so the conversion is this adapter's payload shaping only. An index
 * that a JavaScript number cannot hold exactly is refused rather than rounded.
 */
function statusListIndexAsVckitNumber(value: unknown): number {
  const canonical = canonicalStatusListIndex(value, { source: 'input' });
  const number = Number(canonical);
  if (!Number.isSafeInteger(number)) {
    throw new VcStatusEntryUnsupportedError(
      `Status entry index "${canonical}" cannot be represented exactly as a JavaScript number`,
      'index',
    );
  }
  return number;
}

function statusEntryForIssuedCredential(entry: CredentialStatusEntry): IssuedCredentialStatusEntry {
  // The UNTP v0.7.0 schemas type `statusListIndex` as an integer while the W3C Bitstring Status List specification
  // requires a string in base 10. The integer is emitted so credentials validate against the published UNTP schemas;
  // revert to the string when the UNTP schema is corrected (upstream issue to follow).
  return { ...entry, statusListIndex: statusListIndexAsVckitNumber(entry.statusListIndex) };
}

function assertStatusEntryForManagement(entry: unknown): CanonicalCredentialStatusEntry {
  return parseCredentialStatusEntry(entry, { source: 'input' });
}

function assertNotAborted(signal: AbortSignal | undefined, operation: 'read' | 'set' | 'mint'): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (operation === 'set') throw new VcStatusSetError('Status request was aborted', false, undefined, reason);
  if (operation === 'mint') throw new VcCredentialStatusError('Status request was aborted', undefined, reason);
  throw new VcStatusReadError('Status request was aborted', undefined, reason);
}

function parseStatusCheckResponse(body: unknown): { revoked: boolean; errors: string[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new VcStatusResponseInvalidError('Status check response must be an object');
  }
  const record = body as Record<string, unknown>;
  if (typeof record.revoked !== 'boolean') {
    throw new VcStatusResponseInvalidError('Status check response "revoked" must be a boolean');
  }
  if (record.errors === undefined) {
    return {
      revoked: record.revoked,
      errors: typeof record.message === 'string' && record.message.length > 0 ? [record.message] : [],
    };
  }
  if (!Array.isArray(record.errors)) {
    throw new VcStatusResponseInvalidError('Status check response "errors" must be an array');
  }
  const errors = record.errors.map((error, index) => {
    if (typeof error !== 'object' || error === null || Array.isArray(error)) {
      throw new VcStatusResponseInvalidError(`Status check response error ${index} must be an object`);
    }
    const message = (error as Record<string, unknown>).message;
    if (typeof message !== 'string' || message.length === 0) {
      throw new VcStatusResponseInvalidError(`Status check response error ${index} must have a message`);
    }
    return message;
  });
  return { revoked: record.revoked, errors };
}

/**
 * Validates the issue response envelope. VCKit can return either a context
 * string or a non-empty context array.
 */
function parseIssuedCredentialResponse(body: unknown): EnvelopedVerifiableCredential {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Issue API returned a non-object response body');
  }
  const issued = (body as Record<string, unknown>).verifiableCredential;
  if (typeof issued !== 'object' || issued === null || Array.isArray(issued)) {
    throw new Error('Issue API response is missing verifiableCredential');
  }
  const credential = issued as Record<string, unknown>;
  const context = credential['@context'];
  const hasValidContext =
    (typeof context === 'string' && context.length > 0) || (Array.isArray(context) && context.length > 0);
  if (credential.type !== 'EnvelopedVerifiableCredential' || typeof credential.id !== 'string' || !hasValidContext) {
    throw new Error('Issue API returned an invalid enveloped credential');
  }
  return issued as EnvelopedVerifiableCredential;
}

export class VCKitVerifiableCredentialService extends BaseServiceAdapter implements IVerifiableCredentialService {
  private readonly baseOrigin: string;
  private readonly headers: Record<string, string>;

  constructor(config: VCKitVerifiableCredentialConfig, logger: LoggerService) {
    super(logger.child({ service: 'VC - VCKitVerifiableCredential' }));
    this.baseOrigin = new URL(config.baseUrl).origin;
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
  }

  async sign(credentialPayload: CredentialPayload, options?: SignOptions): Promise<EnvelopedVerifiableCredential> {
    if (
      !credentialPayload.credentialSubject ||
      (typeof credentialPayload.credentialSubject === 'object' &&
        !Array.isArray(credentialPayload.credentialSubject) &&
        Object.keys(credentialPayload.credentialSubject).length === 0)
    ) {
      throw new VcSignError('credentialSubject is required in credential payload');
    }

    const purposes = statusPurposes(options?.statusPurposes);
    const issuerId = validateStatusIssuer(credentialPayload.issuer, 'credential-status');
    assertNotAborted(options?.signal, 'mint');

    this.logger.debug('Issuing credential status');
    const credentialStatuses: CredentialStatusEntry[] = [];
    try {
      for (const purpose of purposes) {
        const mint = () => this.issueCredentialStatus(issuerId, purpose, options?.signal);
        const key = this.statusSerialisationKey(issuerId);
        credentialStatuses.push(await (options?.serialise ? options.serialise(key, mint, options.signal) : mint()));
      }
      const vc = this.constructVerifiableCredential(
        credentialStatuses.length === 0
          ? credentialPayload
          : {
              ...credentialPayload,
              credentialStatus:
                credentialStatuses.length === 1
                  ? statusEntryForIssuedCredential(credentialStatuses[0])
                  : credentialStatuses.map(statusEntryForIssuedCredential),
            },
      );

      this.logger.debug('Issuing verifiable credential');
      return await this.issueVerifiableCredential(vc, options?.signal);
    } catch (error) {
      if (credentialStatuses.length > 0) {
        this.logger.warn(
          {
            issuerDid: issuerId,
            orphanedEntries: credentialStatuses.map(({ statusListCredential, statusListIndex }) => ({
              statusListCredential,
              statusListIndex,
            })),
          },
          'Credential status entries were minted before issuance failed',
        );
      }
      throw error;
    }
  }

  private statusSerialisationKey(statusListIssuer: string): string {
    return `status-list:${this.baseOrigin}:${statusListIssuer}`;
  }

  async verify(credential: EnvelopedVerifiableCredential, options?: VerifyOptions): Promise<VerifyResult> {
    if (!credential) throw new VcVerifyError('Credential is required');

    // With the window enforced, this adapter judges validFrom and validUntil
    // itself after the provider answers (see checkValidityWindow); a caller
    // that needs proof and status evidence for a credential outside its
    // window asks for the window to be skipped, which also relaxes the
    // provider's own JOSE exp and nbf policies. Signature and status
    // policies are never relaxed here.
    const skipValidityWindow = options?.validityWindow === false;
    const verifyParams = {
      credential,
      fetchRemoteContexts: true,
      policies: {
        credentialStatus: true,
        ...(skipValidityWindow ? { issuanceDate: false, expirationDate: false } : {}),
      },
    };

    this.logger.debug('Verifying credential');
    const response = await httpFetch(`${this.baseOrigin}/agent/routeVerificationCredential`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(verifyParams),
    });

    if (!response.ok) {
      const detail = `HTTP ${response.status}: ${response.statusText}`;
      this.logger.error({ httpStatus: response.status }, 'Verification API request failed');
      throw new VcVerifyError(detail, response.status);
    }

    const vckitResult = parseVerifyResponse(await response.json());
    let result = transformVerifyResult(vckitResult);
    if (result.verified && !skipValidityWindow) {
      // VCKit's own window check reads only the JOSE exp and nbf claims, which
      // the VCDM 2.0 issuer does not set, so the credential's validFrom and
      // validUntil are judged here for every caller (see checkValidityWindow).
      const window = checkValidityWindow(credential);
      if (window.result === 'fail') {
        result = { verified: false, error: { type: VerificationErrorCode.Temporal, message: window.message } };
      }
    }
    this.logger.info({ verified: result.verified }, 'Credential verification complete');
    return result;
  }

  async setCredentialStatus(input: SetCredentialStatusInput): Promise<void> {
    const entry = assertStatusEntryForManagement(input.entry);
    const statusListIssuer = validateStatusIssuer(input.statusListIssuer, 'input');
    if (typeof input.value !== 'boolean') {
      throw new VcStatusEntryUnsupportedError('Status value must be a boolean', 'input');
    }
    const index = statusListIndexAsVckitNumber(entry.statusListIndex);
    assertNotAborted(input.signal, 'set');

    const set = async (): Promise<void> => {
      let response: Response;
      try {
        response = await httpFetch(`${this.baseOrigin}/agent/setBitstringStatus`, {
          method: 'POST',
          headers: this.headers,
          signal: input.signal,
          body: JSON.stringify({
            statusListCredential: entry.statusListCredential,
            statusListVCIssuer: statusListIssuer,
            statusPurpose: entry.statusPurpose,
            index,
            status: input.value,
          }),
        });
      } catch (error) {
        throw new VcStatusSetError('Status provider request failed', true, undefined, error);
      }

      if (!response.ok) {
        const detail = await readResponseDetail(response);
        const mayHaveApplied = response.status < 400 || response.status >= 500;
        throw new VcStatusSetError(detail, mayHaveApplied, response.status);
      }

      try {
        const body = await response.json();
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          throw new Error('Status set response must be an object');
        }
        const status = (body as Record<string, unknown>).status;
        if (typeof status !== 'boolean') {
          throw new Error('Status set response must contain a boolean "status"');
        }
        // VCKit echoes the request argument, so a match proves the request was parsed, not that the bit was written; the caller's read-back is the confirmation.
        if (status !== input.value) {
          throw new Error(`provider reported ${status} after a request for ${input.value}`);
        }
      } catch (error) {
        throw new VcStatusSetError(
          error instanceof Error ? error.message : 'Status set response could not be parsed or validated',
          true,
          response.status,
          error,
        );
      }
    };

    await (input.serialise ? input.serialise(this.statusSerialisationKey(statusListIssuer), set, input.signal) : set());
  }

  async getCredentialStatus(input: GetCredentialStatusInput): Promise<CredentialStatusObservation> {
    const entry = assertStatusEntryForManagement(input.entry);
    const statusListIssuer = validateStatusIssuer(input.statusListIssuer, 'input');
    const index = statusListIndexAsVckitNumber(entry.statusListIndex);
    assertNotAborted(input.signal, 'read');

    const providerEntry = { ...entry, statusListIndex: index };
    let response: Response;
    try {
      response = await httpFetch(`${this.baseOrigin}/agent/checkBitstringStatus`, {
        method: 'POST',
        headers: this.headers,
        signal: input.signal,
        body: JSON.stringify({
          verifiableCredential: {
            credentialStatus: providerEntry,
            issuer: { id: statusListIssuer },
          },
        }),
      });
    } catch (error) {
      throw new VcStatusReadError('Status provider request failed', undefined, error);
    }

    if (!response.ok) {
      const detail = await readResponseDetail(response);
      if (response.status === 404) throw new VcStatusListNotFoundError(detail);
      throw new VcStatusReadError(detail, response.status);
    }

    let result: { revoked: boolean; errors: string[] };
    try {
      result = parseStatusCheckResponse(await response.json());
    } catch (error) {
      if (error instanceof VcStatusResponseInvalidError) throw error;
      throw new VcStatusReadError('Status check response could not be parsed', undefined, error);
    }
    if (result.errors.length > 0) throw new VcStatusReadError(result.errors.join('; '));
    return {
      statusPurpose: entry.statusPurpose,
      statusListCredential: entry.statusListCredential,
      statusListIndex: entry.statusListIndex,
      value: result.revoked,
      observedAt: generateCurrentDatetime(),
    };
  }

  // -- Private helpers ----------------------------------------------------

  private constructVerifiableCredential(
    payload: CredentialPayload & { credentialStatus?: CredentialStatus | IssuedCredentialStatus },
  ): UNTPVerifiableCredential {
    const context = [...new Set([VC_CONTEXT_V2, ...(payload['@context'] || [])])];
    const type = [...new Set([VC_TYPE, ...(payload.type || [])])];
    return { ...payload, '@context': context, type } as UNTPVerifiableCredential;
  }

  private async issueVerifiableCredential(
    vc: UNTPVerifiableCredential,
    signal?: AbortSignal,
  ): Promise<EnvelopedVerifiableCredential> {
    let response: Response;
    try {
      response = await httpFetch(`${this.baseOrigin}/v2/credentials/issue`, {
        method: 'POST',
        headers: this.headers,
        signal,
        body: JSON.stringify({ credential: vc, options: { proofFormat: PROOF_FORMAT } }),
      });
    } catch (error) {
      throw new VcSignError('Issue API request failed', undefined, error);
    }

    if (!response.ok) {
      const detail = await readResponseDetail(response);
      this.logger.error({ httpStatus: response.status }, 'Issue API request failed');
      throw new VcSignError(detail, response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new VcSignError('Issue API response could not be parsed', undefined, error);
    }
    let result: EnvelopedVerifiableCredential;
    try {
      result = parseIssuedCredentialResponse(body);
    } catch (error) {
      throw new VcSignError((error as Error).message, undefined, error);
    }
    this.logger.info('Credential issued successfully');
    return result;
  }

  private async issueCredentialStatus(
    issuerId: string,
    statusPurpose: string,
    signal?: AbortSignal,
  ): Promise<CredentialStatusEntry> {
    assertNotAborted(signal, 'mint');

    let response: Response;
    try {
      response = await httpFetch(`${this.baseOrigin}/agent/issueBitstringStatusList`, {
        method: 'POST',
        headers: this.headers,
        signal,
        body: JSON.stringify({ statusPurpose, bitstringStatusIssuer: issuerId }),
      });
    } catch (error) {
      throw new VcCredentialStatusError('Status provider request failed', undefined, error);
    }

    if (!response.ok) {
      const detail = await readResponseDetail(response);
      this.logger.error({ httpStatus: response.status }, 'Credential status API request failed');
      throw new VcCredentialStatusError(detail, response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new VcCredentialStatusError('Status provider response could not be parsed', undefined, error);
    }
    try {
      const canonical = parseCredentialStatusEntry(body, { source: 'provider' });
      return { ...(body as CredentialStatusEntry), statusListIndex: canonical.statusListIndex };
    } catch (error) {
      throw new VcCredentialStatusError((error as Error).message, undefined, error);
    }
  }
}

export const vckitVerifiableCredentialRegistryEntry = {
  configSchema: vckitVerifiableCredentialConfigSchema,
  sensitiveFields: vckitVerifiableCredentialSensitiveFields,
  factory: (config: VCKitVerifiableCredentialConfig, logger: LoggerService): IVerifiableCredentialService =>
    new VCKitVerifiableCredentialService(config, logger),
} satisfies AdapterRegistryEntry<VCKitVerifiableCredentialConfig, IVerifiableCredentialService>;
