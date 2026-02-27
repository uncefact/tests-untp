'use server';

import { auth } from '@/auth';
import { getOidcEndpoints } from '@/lib/auth/oidc-discovery';

/**
 * Returns the OIDC end_session_endpoint URL for logging out of the identity provider.
 *
 * Must be a server action because it needs:
 * - Access to the session (requires cookies, server-side only)
 * - The discovered end_session_endpoint (server-side only, no client env var needed)
 */
export async function getLogoutUrl(): Promise<string | null> {
  const session = await auth();

  if (!session?.id_token) {
    return null;
  }

  const postLogoutRedirectUri = process.env.RI_APP_URL;
  if (!postLogoutRedirectUri) {
    return null;
  }

  try {
    const { end_session_endpoint } = await getOidcEndpoints();

    const logoutUrl = new URL(end_session_endpoint);
    logoutUrl.searchParams.set('id_token_hint', session.id_token);
    logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);

    return logoutUrl.toString();
  } catch (error) {
    console.error('Failed to construct OIDC logout URL. Falling back to local-only logout.', error);
    return null;
  }
}
