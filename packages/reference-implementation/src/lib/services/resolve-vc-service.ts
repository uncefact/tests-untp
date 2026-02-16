import { ServiceType } from '@uncefact/untp-ri-services';
import type { IVerifiableCredentialService } from '@uncefact/untp-ri-services';
import { resolveService } from './resolve-service.js';
import type { ResolvedService } from './resolve-service.js';

export type ResolvedVcService = ResolvedService<IVerifiableCredentialService>;

export async function resolveVcService(tenantId: string, explicitInstanceId?: string): Promise<ResolvedVcService> {
  return resolveService<IVerifiableCredentialService>(tenantId, ServiceType.VC, explicitInstanceId);
}
