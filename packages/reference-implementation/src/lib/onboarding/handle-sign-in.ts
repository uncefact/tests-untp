import type { PrismaClient } from '@/lib/prisma/generated';
import { cloneSystemDefaults } from './clone-system-defaults';
import { createLogger } from '@uncefact/untp-ri-services/logging';

const logger = createLogger().child({ module: 'handle-sign-in' });

interface UserProfile {
  name?: string | null;
  email?: string | null;
}

interface AccountInfo {
  providerAccountId: string;
}

/**
 * Handles auto-onboarding when a user signs in via OAuth.
 * Sets their authProviderId if missing and creates a tenant
 * with cloned system defaults if they don't have one yet.
 *
 * Idempotent: no-op when the user is already fully onboarded.
 */
export async function handleSignIn(
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

    await cloneSystemDefaults(prisma, tenant.id);
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
