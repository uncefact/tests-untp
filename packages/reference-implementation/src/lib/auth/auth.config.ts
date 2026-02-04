/**
 * Shared Authentication Configuration
 *
 * This config is used by:
 * - src/auth.ts (server-side, with Prisma adapter)
 * - src/middleware.ts (edge runtime, no Prisma)
 */

import { type NextAuthConfig } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

export const authConfig: NextAuthConfig = {
  trustHost: process.env.AUTH_TRUST_HOST === 'true',
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60,
    updateAge: 5 * 60,
  },
  providers: [
    Keycloak({
      issuer: process.env.AUTH_KEYCLOAK_ISSUER!,
      clientId: process.env.AUTH_KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.AUTH_KEYCLOAK_CLIENT_SECRET!,
      // When the OIDC issuer hostname is only reachable from within Docker,
      // allow overriding the browser-facing authorization URL separately.
      ...(process.env.AUTH_KEYCLOAK_AUTHORIZATION_URL && {
        authorization: { url: process.env.AUTH_KEYCLOAK_AUTHORIZATION_URL },
      }),
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.id_token = account.id_token;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      if (token.id_token) {
        session.id_token = token.id_token as string;
      }
      return session;
    },
  },
};
