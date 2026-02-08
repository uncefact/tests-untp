import type { PrismaClient } from "@/lib/prisma/generated";
import { cloneSystemDefaults } from "./clone-system-defaults";

interface UserProfile {
  name?: string | null;
  email?: string | null;
}

interface AccountInfo {
  providerAccountId: string;
}

/**
 * Handles auto-onboarding when a user signs in via OAuth.
 * Sets their authProviderId if missing and creates an organisation
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
  // Look up the user's current onboarding state
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { authProviderId: true, organizationId: true },
  });

  if (!dbUser) return;

  // Fast path: already fully onboarded
  if (dbUser.authProviderId && dbUser.organizationId) return;

  const updates: Record<string, unknown> = {};

  if (!dbUser.authProviderId) {
    updates.authProviderId = account.providerAccountId;
  }

  if (!dbUser.organizationId) {
    const baseName = userProfile.name || userProfile.email?.split('@')[0] || 'My';
    const orgName = `${baseName} Organisation`;

    const org = await prisma.organization.create({
      data: { name: orgName },
    });
    updates.organizationId = org.id;

    // Clone system service instances and default DID into the new organisation
    await cloneSystemDefaults(prisma, org.id);
  }

  if (Object.keys(updates).length > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: updates,
    });
  }
}
