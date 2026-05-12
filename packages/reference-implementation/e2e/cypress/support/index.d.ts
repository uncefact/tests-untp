declare namespace Cypress {
  interface Chainable<Subject = any> {
    /**
     * Programmatic login via Keycloak for API testing.
     *
     * Visits the NextAuth sign-in page, follows the Keycloak redirect,
     * fills in credentials, and returns to the app with a valid session cookie.
     * Subsequent cy.request() calls automatically include the session cookie.
     */
    apiLogin(username?: string, password?: string): Chainable<void>;
  }
}
