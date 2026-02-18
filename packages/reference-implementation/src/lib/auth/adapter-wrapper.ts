import type { Adapter, AdapterUser } from 'next-auth/adapters';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '@uncefact/untp-ri-services/logging';

const logger = createLogger().child({ module: 'adapter-wrapper' });

/**
 * Wraps a NextAuth adapter to check for pre-provisioned users before creating new ones.
 *
 * When a user signs in via browser OAuth, NextAuth calls adapter.createUser() with the
 * normalised profile. If the user was previously provisioned by a service account
 * (resolveServiceAccountUser created a User with authProviderId set), this wrapper
 * finds and returns that existing user instead of creating a duplicate.
 *
 * The incoming profile.id is the Keycloak sub (external ID). PrismaAdapter would
 * normally strip this and auto-generate a cuid. We intercept to check authProviderId first.
 */
export function withPreProvisionedUserLookup(baseAdapter: Adapter, prisma: PrismaClient): Adapter {
  return {
    ...baseAdapter,
    async createUser(data: AdapterUser & { id: string }): Promise<AdapterUser> {
      const externalId = data.id;

      if (externalId) {
        const existing = await prisma.user.findUnique({
          where: { authProviderId: externalId },
        });

        if (existing) {
          logger.info(
            { authProviderId: externalId, userId: existing.id },
            'Found pre-provisioned user — skipping adapter createUser',
          );
          return {
            id: existing.id,
            name: existing.name,
            email: existing.email!,
            emailVerified: existing.emailVerified,
            image: existing.image,
          };
        }
      }

      // No pre-provisioned user found — delegate to original adapter
      return baseAdapter.createUser!(data);
    },
  };
}
