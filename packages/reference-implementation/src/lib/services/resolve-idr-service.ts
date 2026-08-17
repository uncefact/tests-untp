import { ServiceType } from '@uncefact/untp-ri-services';
import type { IIdentityResolverService } from '@uncefact/untp-ri-services';
import { resolveService } from './resolve-service';
import type { ResolvedService } from './resolve-service';

export type ResolvedIdrService = ResolvedService<IIdentityResolverService>;

/**
 * Resolves the IDR service instance for a given tenant and optional explicit overrides.
 *
 * Resolution precedence (highest to lowest):
 * 1. Scheme-level: `IdentifierScheme.idrServiceInstanceId`
 * 2. Registrar-level: `Registrar.idrServiceInstanceId`
 * 3. System default: tenant's primary IDR service instance (or system-wide default)
 *
 * Both the credentials route and the identifier links route pass the full
 * chain (scheme, then registrar, then tenant or system default); see ADR-044.
 */
export async function resolveIdrService(
  tenantId: string,
  schemeIdrServiceInstanceId?: string | null,
  registrarIdrServiceInstanceId?: string | null,
): Promise<ResolvedIdrService> {
  const explicitId = schemeIdrServiceInstanceId ?? registrarIdrServiceInstanceId ?? undefined;
  return resolveService<IIdentityResolverService>(tenantId, ServiceType.IDR, explicitId);
}
