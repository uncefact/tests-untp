import type { PrismaClient } from '@/lib/prisma/generated';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import { getTenantConfig } from '@/lib/auth/tenant-config';
import { extractGroupClaim } from '@/lib/auth/group-claim';
import { decodeAccessToken } from '@/lib/auth/keycloak-token';

const logger = createLogger().child({ module: 'handle-sign-in' });

interface UserProfile {
  name?: string | null;
  email?: string | null;
}

interface AccountInfo {
  providerAccountId: string;
  access_token?: string;
}

/**
 * Handles auto-onboarding when a user signs in via OAuth.
 *
 * Open mode: Sets authProviderId if missing and creates a tenant
 * if the user doesn't have one yet. Idempotent.
 *
 * Closed mode: Extracts the group claim from the access token,
 * resolves the tenant by externalIdpGroupId, and links the user.
 * Creates the tenant if it doesn't exist yet.
 */
export async function handleSignIn(
  prisma: PrismaClient,
  userId: string,
  account: AccountInfo,
  userProfile: UserProfile,
): Promise<void> {
  const tenantConfig = getTenantConfig();

  if (tenantConfig.mode === 'closed') {
    return handleClosedModeSignIn(prisma, userId, account, tenantConfig);
  }

  return handleOpenModeSignIn(prisma, userId, account, userProfile);
}

async function handleClosedModeSignIn(
  prisma: PrismaClient,
  userId: string,
  account: AccountInfo,
  tenantConfig: { mode: 'closed'; claimName: string; claimFormat: 'array_first' | 'string' },
): Promise<void> {
  logger.debug({ userId }, 'Handling closed mode sign-in');

  if (!account.access_token) {
    logger.warn({ userId }, 'No access token in account — cannot extract group claim');
    return;
  }

  const payload = decodeAccessToken(account.access_token);
  const groupClaim = extractGroupClaim(payload, tenantConfig);

  if (!groupClaim) {
    logger.warn({ userId }, 'No group claim found in access token');
    return;
  }

  try {
    await resolveClosedModeSignIn(prisma, userId, groupClaim, account.providerAccountId);
  } catch (error: unknown) {
    if (isUniqueConstraintViolation(error)) {
      logger.warn({ userId, groupClaim }, 'Closed mode sign-in conflict — retrying');
      await resolveClosedModeSignIn(prisma, userId, groupClaim, account.providerAccountId);
      return;
    }
    throw error;
  }
}

async function resolveClosedModeSignIn(
  prisma: PrismaClient,
  userId: string,
  groupClaim: string,
  providerAccountId: string,
): Promise<void> {
  // Ensure authProviderId is set
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { authProviderId: true, tenantId: true },
  });

  if (!dbUser) {
    logger.warn({ userId }, 'User not found in database during closed mode sign-in');
    return;
  }

  const updates: Record<string, unknown> = {};

  if (!dbUser.authProviderId) {
    updates.authProviderId = providerAccountId;
  }

  // Look up or create tenant by group claim
  let tenant = await prisma.tenant.findUnique({
    where: { externalIdpGroupId: groupClaim },
    select: { id: true },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: 'My Organisation', externalIdpGroupId: groupClaim },
    });
    logger.info({ userId, tenantId: tenant.id, groupClaim }, 'Created tenant for group claim');
  }

  // Link user to tenant (re-link if group changed)
  if (dbUser.tenantId !== tenant.id) {
    updates.tenantId = tenant.id;
  }

  if (Object.keys(updates).length > 0) {
    logger.info({ userId, updates: Object.keys(updates) }, 'Updating user with closed mode onboarding data');
    await prisma.user.update({
      where: { id: userId },
      data: updates,
    });
  }

  logger.info({ userId, tenantId: tenant.id }, 'Closed mode sign-in completed');
}

async function handleOpenModeSignIn(
  prisma: PrismaClient,
  userId: string,
  account: AccountInfo,
  userProfile: UserProfile,
): Promise<void> {
  logger.debug({ userId }, 'Handling user sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { authProviderId: true, tenantId: true },
  });

  if (!dbUser) {
    logger.warn({ userId }, 'User not found in database');
    return;
  }

  if (dbUser.authProviderId && dbUser.tenantId) {
    logger.debug({ userId }, 'User already fully onboarded');
    return;
  }

  const updates: Record<string, unknown> = {};

  if (!dbUser.authProviderId) {
    updates.authProviderId = account.providerAccountId;
  }

  if (!dbUser.tenantId) {
    const baseName = userProfile.name || userProfile.email?.split('@')[0] || 'My';
    const tenantName = `${baseName} Organisation`;

    logger.info({ userId, tenantName }, 'Creating tenant for user');

    const tenant = await prisma.tenant.create({
      data: { name: tenantName },
    });
    updates.tenantId = tenant.id;
  }

  if (Object.keys(updates).length > 0) {
    logger.info({ userId, updates: Object.keys(updates) }, 'Updating user with onboarding data');
    await prisma.user.update({
      where: { id: userId },
      data: updates,
    });
  }

  logger.info({ userId }, 'User onboarding completed successfully');
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
