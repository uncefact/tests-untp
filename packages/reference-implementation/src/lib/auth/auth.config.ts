/**
 * Shared Authentication Configuration
 *
 * This config is used by:
 * - src/auth.ts (server-side, with Prisma adapter)
 * - src/middleware.ts (edge runtime, no Prisma)
 *
 * In closed mode, the JWT callback performs token rotation via IdP
 * refresh tokens to keep the group claim fresh (~5 minute window).
 */

import { type NextAuthConfig } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';
import { getTenantConfig } from '@/lib/auth/tenant-config';
import { extractGroupClaim } from '@/lib/auth/group-claim';
import { refreshKeycloakToken, decodeAccessToken } from '@/lib/auth/keycloak-token';

const tenantConfig = getTenantConfig();

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
      // Initial sign-in
      if (account) {
        token.id_token = account.id_token;

        if (tenantConfig.mode === 'closed') {
          token.access_token = account.access_token;
          token.refresh_token = account.refresh_token;
          token.expires_at = account.expires_at;

          const payload = decodeAccessToken(account.access_token!);
          token.group_claim = extractGroupClaim(payload, tenantConfig);
        }

        return token;
      }

      // Subsequent requests — token rotation in closed mode only
      if (tenantConfig.mode === 'closed') {
        // Still valid?
        if (token.expires_at && Date.now() < (token.expires_at as number) * 1000) {
          return token;
        }

        // Refresh
        try {
          const refreshed = await refreshKeycloakToken(token.refresh_token as string);
          token.access_token = refreshed.access_token;
          token.refresh_token = refreshed.refresh_token ?? token.refresh_token;
          token.expires_at = refreshed.expires_at;

          const payload = decodeAccessToken(refreshed.access_token);
          token.group_claim = extractGroupClaim(payload, tenantConfig);

          delete token.error;
        } catch {
          token.error = 'RefreshAccessTokenError';
          delete token.sub;
          delete token.group_claim;
          delete token.access_token;
          delete token.refresh_token;
        }
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

      if (tenantConfig.mode === 'closed') {
        session.group_claim = token.group_claim as string | null | undefined;
        if (token.error) {
          session.error = token.error as string;
        }
      }

      return session;
    },
  },
};
