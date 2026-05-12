import { config } from '../config';

/**
 * Programmatic login via IDP (Keycloak or Zitadel) for API testing.
 *
 * Visits the NextAuth sign-in page, follows the IDP redirect,
 * fills in credentials, and returns to the app with a valid session cookie.
 * Subsequent cy.request() calls automatically include the session cookie.
 */
Cypress.Commands.add('apiLogin', (username?: string, password?: string) => {
  const user = username ?? config.user.email;
  const pass = password ?? config.user.password;
  const provider = config.idp.provider || 'keycloak';

  // Visit the NextAuth sign-in endpoint which redirects to the IDP
  cy.visit('/api/auth/signin');

  // Click the provider button to trigger the redirect
  cy.get('body').then(($body) => {
    // NextAuth shows provider buttons — find and click the right one
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

  // Wait for redirect back to the app
  const appHost = new URL(Cypress.config('baseUrl')!).host;
  cy.url().should('include', appHost);
});
