import { prisma } from '@/lib/prisma/prisma';
import { createLogger } from '@uncefact/untp-ri-services/logging';

const logger = createLogger().child({ module: 'service-account-user' });

export interface ServiceAccountClaims {
  sub: string;
  name?: string;
  email?: string;
}

export interface ResolvedUser {
  userId: string;
  tenantId: string;
}

/**
 * Resolves or provisions a user from service account JWT claims.
 *
 * 1. Queries User by authProviderId = claims.sub
 * 2. If found with tenantId, returns { userId, tenantId }
 * 3. If found without tenantId, logs error and returns null
 * 4. If not found, auto-provisions User + Tenant in a transaction
 * 5. On unique constraint violation (race condition), retries once
 */
export async function resolveServiceAccountUser(claims: ServiceAccountClaims): Promise<ResolvedUser | null> {
  // Step 1: Look up existing user by external ID
  const existing = await prisma.user.findUnique({
    where: { authProviderId: claims.sub },
    select: { id: true, tenantId: true },
  });

  if (existing) {
    if (!existing.tenantId) {
      logger.error({ sub: claims.sub, userId: existing.id }, 'User exists without tenant — unexpected state');
      return null;
    }
    logger.debug(
      { sub: claims.sub, userId: existing.id, tenantId: existing.tenantId },
      'User resolved from authProviderId',
    );
    return { userId: existing.id, tenantId: existing.tenantId };
  }

  // Step 2: Auto-provision within a transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      const baseName = claims.name || claims.email?.split('@')[0] || 'My';
      const tenantName = `${baseName} Organisation`;

      const tenant = await tx.tenant.create({
        data: { name: tenantName },
      });

      const user = await tx.user.create({
        data: {
          authProviderId: claims.sub,
          name: claims.name ?? null,
          email: claims.email ?? null,
          tenantId: tenant.id,
        },
      });

      return { userId: user.id, tenantId: tenant.id };
    });

    logger.info({ sub: claims.sub, userId: result.userId, tenantId: result.tenantId }, 'New user auto-provisioned');
    return result;
  } catch (error: unknown) {
    // Step 3: Retry on unique constraint violation (race condition)
    if (isUniqueConstraintViolation(error)) {
      logger.warn({ sub: claims.sub }, 'Provisioning conflict — retrying lookup');

      const retryUser = await prisma.user.findUnique({
        where: { authProviderId: claims.sub },
        select: { id: true, tenantId: true },
      });

      if (retryUser?.tenantId) {
        return { userId: retryUser.id, tenantId: retryUser.tenantId };
      }
    }

    logger.error({ sub: claims.sub, error }, 'Failed to provision service account user');
    return null;
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
