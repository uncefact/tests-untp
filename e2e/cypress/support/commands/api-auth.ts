/**
 * Programmatic login via Keycloak for API testing.
 *
 * Visits the NextAuth sign-in page, follows the Keycloak redirect,
 * fills in credentials, and returns to the app with a valid session cookie.
 * Subsequent cy.request() calls automatically include the session cookie.
 */
Cypress.Commands.add('apiLogin', (username?: string, password?: string) => {
  const user = username ?? 'e2e-admin@test.local';
  const pass = password ?? 'E2eTest123!';

  // Visit the NextAuth sign-in endpoint which redirects to Keycloak
  cy.visit('/api/auth/signin');

  // Click the Keycloak provider button (if present)
  cy.get('body').then(($body) => {
    if ($body.find('button:contains("Keycloak")').length) {
      cy.contains('button', 'Keycloak').click();
    }
    // If already on the Keycloak login page, continue
  });

  // Fill in Keycloak credentials
  cy.origin(
    'http://localhost:8081',
    { args: { user, pass } },
    ({ user, pass }) => {
      cy.get('#username').type(user);
      cy.get('#password').type(pass);
      cy.get('#kc-login').click();
    },
  );

  // Wait for redirect back to the app
  cy.url().should('include', 'localhost:3003');
});
