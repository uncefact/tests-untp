import { ServiceType } from '@uncefact/untp-ri-services';
import type { IIdentityResolverService } from '@uncefact/untp-ri-services';
import { resolveService } from './resolve-service';
import type { ResolvedService } from './resolve-service';

export type ResolvedIdrService = ResolvedService<IIdentityResolverService>;

export async function resolveIdrService(
  tenantId: string,
  schemeIdrServiceInstanceId?: string | null,
  registrarIdrServiceInstanceId?: string | null,
): Promise<ResolvedIdrService> {
  const explicitId = schemeIdrServiceInstanceId ?? registrarIdrServiceInstanceId ?? undefined;
  return resolveService<IIdentityResolverService>(tenantId, ServiceType.IDR, explicitId);
}
