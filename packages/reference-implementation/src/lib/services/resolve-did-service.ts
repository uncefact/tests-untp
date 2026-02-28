import { ServiceType } from '@uncefact/untp-ri-services';
import type { IDidService, AdapterRegistryEntry } from '@uncefact/untp-ri-services';
import { didAdapterRegistry } from '@uncefact/untp-ri-services/server';
import { resolveService } from './resolve-service';
import type { ResolvedService } from './resolve-service';

export type ResolvedDidService = ResolvedService<IDidService>;

export async function resolveDidService(tenantId: string, serviceInstanceId?: string): Promise<ResolvedDidService> {
  return resolveService<IDidService>(
    tenantId,
    ServiceType.VC,
    serviceInstanceId,
    didAdapterRegistry as Record<string, AdapterRegistryEntry>,
  );
}
