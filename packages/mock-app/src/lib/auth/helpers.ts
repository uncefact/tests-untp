/**
 * Get IDP logout URL
 *
 * Constructs the OIDC end_session_endpoint URL for logging out of the Identity Provider.
 * This ensures the user is logged out of both the application and the IDP.
 *
 * @param session - The user session containing id_token
 * @param redirectUrl - URL to redirect to after logout (defaults to home page)
 * @returns The IDP logout URL, or null if session doesn't have id_token
 */
export function getIdpLogoutUrl(session: { id_token?: string } | null, redirectUrl?: string): string | null {
  if (!session?.id_token) {
    return null;
  }

  const issuer = process.env.NEXT_PUBLIC_AUTH_KEYCLOAK_ISSUER!;
  const baseUrl = process.env.NEXT_PUBLIC_NEXTAUTH_URL!;

  // After IDP logout, redirect to base URL (home page)
  // (NextAuth session is already cleared before reaching IDP)
  const postLogoutRedirectUri = redirectUrl || baseUrl;

  // OIDC standard end_session_endpoint URL
  const logoutUrl = new URL(`${issuer}/protocol/openid-connect/logout`);
  logoutUrl.searchParams.set('id_token_hint', session.id_token);
  logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);

  return logoutUrl.toString();
}
