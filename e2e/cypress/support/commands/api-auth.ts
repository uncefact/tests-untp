/**
 * Programmatic login via Keycloak for API testing.
 *
 * Uses cy.request() to follow the full OAuth redirect chain without
 * browser navigation, avoiding cross-origin issues in CI.
 *
 * Flow:
 * 1. GET  /api/auth/csrf              → CSRF token
 * 2. POST /api/auth/signin/keycloak   → redirects to Keycloak login page
 * 3. POST Keycloak form action        → submits credentials, redirects to callback
 * 4. NextAuth callback sets session cookie automatically
 */
Cypress.Commands.add('apiLogin', (username?: string, password?: string) => {
  const user = username ?? 'e2e-admin@test.local';
  const pass = password ?? 'E2eTest123!';

  // Step 1: Get the CSRF token from NextAuth
  cy.request('/api/auth/csrf')
    .its('body.csrfToken')
    .then((csrfToken: string) => {
      // Step 2: Initiate the Keycloak sign-in flow.
      // cy.request follows redirects and lands on the Keycloak login page HTML.
      cy.request({
        method: 'POST',
        url: '/api/auth/signin/keycloak',
        form: true,
        body: { csrfToken, callbackUrl: 'http://localhost:3003/' },
      }).then((keycloakPage) => {
        // Step 3: Extract the Keycloak login form action URL from the HTML
        const html: string = keycloakPage.body;
        const match = html.match(/action="([^"]+)"/);
        if (!match) {
          throw new Error(
            'Could not find Keycloak login form action URL in response. ' +
            'Is Keycloak healthy and the realm configured?',
          );
        }
        const formAction = match[1].replace(/&amp;/g, '&');

        // Step 4: Submit credentials to Keycloak.
        // cy.request follows the redirect chain back through NextAuth's
        // callback endpoint, which sets the session cookie.
        cy.request({
          method: 'POST',
          url: formAction,
          form: true,
          body: { username: user, password: pass },
        });
      });
    });
});
