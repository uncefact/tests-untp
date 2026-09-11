import { config } from '../config';

/**
 * Programmatic login via IDP (Keycloak or Zitadel) for API testing.
 *
 * Visits the NextAuth sign-in page, follows the IDP redirect,
 * fills in credentials, and validates the session on a quiet test page.
 * Subsequent cy.request() calls automatically include the session cookie.
 */
Cypress.Commands.add('apiLogin', (username?: string, password?: string) => {
  const user = username ?? config.user.email;
  const pass = password ?? config.user.password;
  const provider = config.idp.provider || 'keycloak';

  // Keeping API setup on a scriptless page stops the browser's session and DID
  // fetches from updating cookies at the same time as cy.request() (#783, #522).
  // Only the landing document is stubbed. The IDP, callback and session check
  // below still use the real application authentication flow.
  const callbackUrl = new URL('/', Cypress.config('baseUrl')!).href;
  cy.intercept(
    { method: 'GET', url: callbackUrl, times: 1 },
    {
      statusCode: 200,
      headers: { 'content-type': 'text/html', 'cache-control': 'no-store' },
      body: '<!doctype html><html><head><title>API login complete</title></head><body>API login complete</body></html>',
    },
  );

  // Visit the NextAuth sign-in endpoint which redirects to the IDP
  cy.visit(`/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);

  // Click the provider button to trigger the redirect
  cy.get('body').then(($body) => {
    // NextAuth shows provider buttons  -  find and click the right one
    const buttons = $body.find('button');
    const providerButton = buttons.filter((_i, el) => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('keycloak') || text.includes('zitadel');
    });
    if (providerButton.length) {
      cy.wrap(providerButton.first()).click();
    }
  });

  // Fill in credentials on the IDP login page
  cy.origin(config.idp.baseUrl, { args: { user, pass, provider } }, ({ user, pass, provider }) => {
    if (provider === 'zitadel') {
      // Zitadel: email first, then password on next screen
      cy.get('#loginName').type(user);
      cy.get('button[type="submit"]').click();
      cy.get('#password').type(pass);
      cy.get('button[type="submit"]').click();
    } else {
      // Keycloak
      cy.get('#username').type(user);
      cy.get('#password').type(pass);
      cy.get('#kc-login').click();
    }
  });

  // A URL containing the app host can still be an intermediate auth page.
  // Wait for the final document, then let the server accept (and renew) the
  // cookie before callers start API setup. No browser fetches run here.
  cy.location('href').should('eq', callbackUrl);
  cy.document().its('title').should('eq', 'API login complete');
  cy.request('/api/auth/session').then(({ body }) => {
    expect(body?.user?.id, 'authenticated session user ID').to.be.a('string').and.not.be.empty;
    expect(body.error, 'session authentication error').to.be.undefined;
    return cy.getAllCookies().then((cookies) => cy.task('captureSessionCookies', { cookies, user }));
  });
});
