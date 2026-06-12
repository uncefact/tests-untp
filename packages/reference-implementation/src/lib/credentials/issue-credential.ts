import type {
  CredentialPayload,
  ExtractedRefs,
  IVerifiableCredentialService,
  IStorageService,
  StorageRecord,
} from '@uncefact/untp-ri-services';
import type { ResolvedService } from '@/lib/services/resolve-service';
import { createCredential } from '@/lib/prisma/repositories';
import { protectDecryptionKey } from './decryption-key-protection';
import { resolvePrimaryEntity } from '@/lib/entities/resolve-primary-entity';
import type { PrimaryEntityResult } from '@/lib/entities/resolve-primary-entity';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'issue-credential' });

export type IssueCredentialInput = {
  tenantId: string;
  credentialPayload: CredentialPayload;
  credentialType: string;
  refs: ExtractedRefs;
  vcService: ResolvedService<IVerifiableCredentialService>;
  storageService: ResolvedService<IStorageService>;
  storageOptions: {
    encrypt?: boolean;
  };
};

export type IssueCredentialResult = {
  credentialId: string;
  storageResponse: StorageRecord;
  primaryEntity: PrimaryEntityResult;
};

export async function issueCredential(input: IssueCredentialInput): Promise<IssueCredentialResult> {
  const { tenantId, credentialPayload, credentialType, refs, vcService, storageService, storageOptions } = input;

  const shouldEncrypt = storageOptions.encrypt !== false;

  logger.info({ tenantId, vcInstanceId: vcService.instanceId }, 'Signing credential');
  const signedCredential = await vcService.service.sign(credentialPayload);

  logger.info({ tenantId, storageInstanceId: storageService.instanceId, shouldEncrypt }, 'Storing credential');
  const storageResponse = await storageService.service.store(signedCredential, shouldEncrypt);

  const primaryEntity = await resolvePrimaryEntity(refs, tenantId);

  const decryptionKey = protectDecryptionKey(storageResponse.decryptionKey);

  const credentialRecord = await createCredential({
    tenantId,
    storageUri: storageResponse.uri,
    digestMultibase: storageResponse.digestMultibase,
    decryptionKey,
    credentialType,
    isPublished: false,
    organisationId: primaryEntity.organisationId,
    facilityId: primaryEntity.facilityId,
    productId: primaryEntity.productId,
  });

  logger.info({ tenantId, credentialId: credentialRecord.id }, 'Credential issued and stored');

  return {
    credentialId: credentialRecord.id,
    storageResponse,
    primaryEntity,
  };
}
