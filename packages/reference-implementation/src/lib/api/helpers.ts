import { auth } from '@/auth';
import { prisma } from '@/lib/prisma/prisma';

/**
 * Resolves the tenant ID for the current authenticated user.
 * Looks up the User by their OAuth sub (which is stored as User.id),
 * then returns their tenantId.
 *
 * Returns null if the user is not found or has no tenant.
 */
export async function getTenantId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true },
  });
  return user?.tenantId ?? null;
}

/**
 * Returns the authenticated user's ID from the session.
 * Returns null if not authenticated.
 */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
