declare namespace Cypress {
  interface Chainable<Subject = any> {
    /**
     * Login via Keycloak or Zitadel for API testing.
     *
     * The real IDP sign-in finishes before this command returns, leaving the
     * browser on a stubbed scriptless document at `/` with the real session
     * validated. That document starts no background requests that could update
     * cookies during API setup.
     * Subsequent cy.request() calls automatically include the session cookie.
     * Specs that exercise the UI must visit their page explicitly afterwards.
     */
    apiLogin(username?: string, password?: string): Chainable<void>;
  }
}
