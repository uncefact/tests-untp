import { prisma } from '@/lib/prisma/prisma';
import { createLogger } from '@uncefact/untp-ri-services/logging';

const logger = createLogger().child({ module: 'resolve-closed-mode-tenant' });

export interface ResolvedClosedModeTenant {
  userId: string;
  tenantId: string;
}

export async function resolveClosedModeTenant(
  groupClaimValue: string,
  sub: string,
  claims?: { name?: string; email?: string },
): Promise<ResolvedClosedModeTenant | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      return await resolveWithinTransaction(tx, groupClaimValue, sub, claims);
    });
  } catch (error: unknown) {
    if (isUniqueConstraintViolation(error)) {
      logger.warn({ groupClaimValue, sub }, 'Closed mode provisioning conflict — retrying');
      return retryResolution(groupClaimValue, sub, claims);
    }

    logger.error({ groupClaimValue, sub, error }, 'Failed to resolve closed mode tenant');
    return null;
  }
}

async function resolveWithinTransaction(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  groupClaimValue: string,
  sub: string,
  claims?: { name?: string; email?: string },
): Promise<ResolvedClosedModeTenant> {
  // Look up tenant and user
  const tenant = await tx.tenant.findUnique({
    where: { externalIdpGroupId: groupClaimValue },
    select: { id: true },
  });

  const user = await tx.user.findUnique({
    where: { authProviderId: sub },
    select: { id: true, tenantId: true },
  });

  // Case 3: both exist, correctly linked
  if (tenant && user && user.tenantId === tenant.id) {
    logger.debug({ sub, tenantId: tenant.id }, 'Fast path — user and tenant linked');
    return { userId: user.id, tenantId: tenant.id };
  }

  // Case 4: both exist, user linked to wrong tenant
  if (tenant && user && user.tenantId !== tenant.id) {
    logger.info({ sub, oldTenantId: user.tenantId, newTenantId: tenant.id }, 'Re-linking user to group tenant');
    await tx.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
    return { userId: user.id, tenantId: tenant.id };
  }

  // Case 5: tenant exists, user does not
  if (tenant && !user) {
    const newUser = await tx.user.create({
      data: {
        authProviderId: sub,
        name: claims?.name ?? null,
        email: claims?.email ?? null,
        tenantId: tenant.id,
      },
    });
    logger.info({ sub, tenantId: tenant.id, userId: newUser.id }, 'Created user for existing group tenant');
    return { userId: newUser.id, tenantId: tenant.id };
  }

  // Case 6: tenant does not exist, user exists
  if (!tenant && user) {
    const newTenant = await tx.tenant.create({
      data: { name: 'My Organisation', externalIdpGroupId: groupClaimValue },
    });
    await tx.user.update({ where: { id: user.id }, data: { tenantId: newTenant.id } });
    logger.info({ sub, tenantId: newTenant.id, groupClaimValue }, 'Created tenant for existing user');
    return { userId: user.id, tenantId: newTenant.id };
  }

  // Case 7: neither exists
  const newTenant = await tx.tenant.create({
    data: { name: 'My Organisation', externalIdpGroupId: groupClaimValue },
  });
  const newUser = await tx.user.create({
    data: {
      authProviderId: sub,
      name: claims?.name ?? null,
      email: claims?.email ?? null,
      tenantId: newTenant.id,
    },
  });
  logger.info({ sub, tenantId: newTenant.id, userId: newUser.id, groupClaimValue }, 'Provisioned new tenant and user');
  return { userId: newUser.id, tenantId: newTenant.id };
}

async function retryResolution(
  groupClaimValue: string,
  sub: string,
  claims?: { name?: string; email?: string },
): Promise<ResolvedClosedModeTenant | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      return await resolveWithinTransaction(tx, groupClaimValue, sub, claims);
    });
  } catch (error) {
    logger.error({ groupClaimValue, sub, error }, 'Retry resolution also failed');
    return null;
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
