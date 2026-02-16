import { ServiceType } from '@uncefact/untp-ri-services';
import type { IDidService } from '@uncefact/untp-ri-services';
import { resolveService } from './resolve-service.js';
import type { ResolvedService } from './resolve-service.js';

export type ResolvedDidService = ResolvedService<IDidService>;

export async function resolveDidService(tenantId: string, serviceInstanceId?: string): Promise<ResolvedDidService> {
  return resolveService<IDidService>(tenantId, ServiceType.DID, serviceInstanceId);
}
