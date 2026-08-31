import {
  decodeCredential,
  type CredentialPayload,
  type EnvelopedVerifiableCredential,
  type ExtractedRefs,
  type IDataModelBridge,
  type UNTPVerifiableCredential,
  type IVerifiableCredentialService,
  type IStorageService,
  type StorageRecord,
} from '@uncefact/untp-ri-services';
import type { ResolvedService } from '@/lib/services/resolve-service';
import { createCredential } from '@/lib/prisma/repositories';
import { IdempotencyClaimLostError } from '@/lib/prisma/repositories/idempotency-key.repository';
import { CredentialDetailsError, CredentialDetailsStatus } from '@/lib/prisma/generated';
import { protectDecryptionKey } from './decryption-key-protection';
import { resolvePrimaryEntity } from '@/lib/entities/resolve-primary-entity';
import type { PrimaryEntityResult } from '@/lib/entities/resolve-primary-entity';
import { apiLogger } from '@/lib/api/logger';
import { extractCredentialDetails } from './extract-credential-details';
import type { CredentialDetailsInput } from '@/lib/prisma/repositories/credential.repository';

const logger = apiLogger.child({ module: 'issue-credential' });

export type IssueCredentialInput = {
  tenantId: string;
  credentialPayload: CredentialPayload;
  credentialType: string;
  /**
   * Spec version the data-model bridge was resolved with. For an extension
   * this is the parent version (`coreDataModelVersion`), so a later read can find
   * the same bridge again.
   */
  coreDataModelVersion: string;
  refs: ExtractedRefs;
  vcService: ResolvedService<IVerifiableCredentialService>;
  storageService: ResolvedService<IStorageService>;
  storageOptions: {
    encrypt?: boolean;
  };
  bridge: IDataModelBridge;
  idempotencyClaimId?: string;
};

export type IssueCredentialResult = {
  credentialId: string;
  storageResponse: StorageRecord;
  primaryEntity: PrimaryEntityResult;
  /**
   * True when the matched entity vanished before the credential row was
   * written, so the credential was stored without its entity links. Advisory
   * enrichment only (ADR-044): the caller is told, and issuance still succeeds.
   */
  entityLinkFailed: boolean;
  /**
   * True when the signed credential's descriptive fields could not be read,
   * so the row carries no name, issuer, subject or dates and records why.
   * Advisory enrichment only, on the same terms as {@link entityLinkFailed}:
   * the caller is told, and issuance still succeeds.
   */
  detailsExtractionFailed: boolean;
};

/**
 * What reading a signed credential's descriptive fields produced.
 *
 * A failure never stops issuance. The credential has been signed by this
 * point, and these fields are enrichment for a later list view, so losing
 * them must not destroy a credential that exists. This is the rule ADR-044
 * already applies to entity links. The row records that the read failed and
 * why, and the caller is told through {@link IssueCredentialResult}.
 */
type DetailsCapture = CredentialDetailsInput & { failed: boolean };

function readCredentialDetails(
  signedCredential: EnvelopedVerifiableCredential,
  bridge: IDataModelBridge,
): DetailsCapture {
  let decoded: UNTPVerifiableCredential;
  try {
    const payload = decodeCredential(signedCredential);
    if (payload === null || typeof payload !== 'object') {
      throw new Error('decoded payload is not an object');
    }
    decoded = payload;
  } catch (error) {
    // The signing adapter produced an envelope this service cannot read back,
    // which is an inconsistency between the two rather than a caller fault.
    logger.error({ err: error }, 'Signed credential could not be decoded; descriptive fields not read');
    return {
      detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
      detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE,
      failed: true,
    };
  }

  try {
    return {
      details: extractCredentialDetails(decoded, bridge),
      detailsStatus: CredentialDetailsStatus.EXTRACTED,
      failed: false,
    };
  } catch (error) {
    // A bridge that throws is a defect in that data model version, so the
    // reason names the bridge: re-reading after a fix is what resolves it.
    logger.error({ err: error }, 'Data-model bridge threw while reading the credential subject');
    return {
      detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
      detailsError: CredentialDetailsError.BRIDGE_ERROR,
      failed: true,
    };
  }
}

export async function issueCredential(input: IssueCredentialInput): Promise<IssueCredentialResult> {
  const {
    tenantId,
    credentialPayload,
    credentialType,
    coreDataModelVersion,
    refs,
    vcService,
    storageService,
    storageOptions,
    bridge,
  } = input;

  const shouldEncrypt = storageOptions.encrypt !== false;

  logger.info({ tenantId, vcInstanceId: vcService.instanceId }, 'Signing credential');
  const signedCredential = await vcService.service.sign(credentialPayload);
  const { failed: detailsExtractionFailed, ...details } = readCredentialDetails(signedCredential, bridge);

  logger.info({ tenantId, storageInstanceId: storageService.instanceId, shouldEncrypt }, 'Storing credential');
  const storageResponse = await storageService.service.store(signedCredential, shouldEncrypt);

  const primaryEntity = await resolvePrimaryEntity(refs, tenantId);

  const decryptionKey = protectDecryptionKey(storageResponse.decryptionKey);

  const { credential: credentialRecord, entityLinkFailed } = await createCredentialOrReportOrphan({
    tenantId,
    storageUri: storageResponse.uri,
    digestMultibase: storageResponse.digestMultibase,
    decryptionKey,
    credentialType,
    coreDataModelVersion,
    isPublished: false,
    organisationId: primaryEntity.organisationId,
    facilityId: primaryEntity.facilityId,
    productId: primaryEntity.productId,
    ...details,
    idempotencyClaimId: input.idempotencyClaimId,
  });

  logger.info({ tenantId, credentialId: credentialRecord.id }, 'Credential issued and stored');

  if (entityLinkFailed) {
    logger.warn(
      { tenantId, credentialId: credentialRecord.id },
      'Credential stored without entity links: the matched entity no longer exists',
    );
  }

  return {
    credentialId: credentialRecord.id,
    storageResponse,
    primaryEntity,
    entityLinkFailed,
    detailsExtractionFailed,
  };
}

/**
 * Writes the credential row, and names what was left behind if the row cannot
 * be written because this request's idempotency claim was reclaimed.
 *
 * Signing and storage have already happened by then and cannot be undone, so
 * the artefact exists in the VC and storage services with no row referring to
 * it. No caller is ever handed it, and the log line is what lets an operator
 * find it (#954, ADR-051).
 */
async function createCredentialOrReportOrphan(
  input: Parameters<typeof createCredential>[0] & { storageUri: string; digestMultibase: string },
): Promise<Awaited<ReturnType<typeof createCredential>>> {
  try {
    return await createCredential(input);
  } catch (error) {
    if (error instanceof IdempotencyClaimLostError) {
      logger.error(
        { err: error, storageUri: input.storageUri, digestMultibase: input.digestMultibase },
        'Idempotency claim was reclaimed before the credential row was written; the stored credential has no record',
      );
    }
    throw error;
  }
}
