import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma/prisma';
import { authConfig } from '@/lib/auth/auth.config';
import { handleSignIn } from '@/lib/onboarding';

/**
 * Full auth instance with PrismaAdapter for API routes and server components.
 *
 * The signIn event handles auto-onboarding: it sets the user's authProviderId
 * and creates an organisation with cloned system defaults on first login.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  events: {
    async signIn({ user, account }) {
      if (!account || !user.id) return;
      try {
        await handleSignIn(prisma, user.id, account, {
          name: user.name,
          email: user.email,
        });
      } catch (error) {
        console.error('[onboarding] Failed during sign-in:', {
          userId: user.id,
          provider: account.provider,
          error: error instanceof Error ? error.message : error,
        });
      }
    },
  },
});
