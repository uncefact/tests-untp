import { ServiceType } from '@uncefact/untp-ri-services';
import type { IStorageService } from '@uncefact/untp-ri-services';
import { resolveService } from './resolve-service.js';
import type { ResolvedService } from './resolve-service.js';

export type ResolvedStorageService = ResolvedService<IStorageService>;

export async function resolveStorageService(
  tenantId: string,
  explicitInstanceId?: string,
): Promise<ResolvedStorageService> {
  return resolveService<IStorageService>(tenantId, ServiceType.STORAGE, explicitInstanceId);
}
