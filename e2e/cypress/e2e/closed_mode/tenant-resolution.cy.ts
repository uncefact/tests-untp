/**
 * Closed mode tenant resolution E2E tests.
 *
 * Verifies that when the app runs with TENANT_MODE=closed, signing in
 * via Keycloak auto-provisions a tenant from the user's group claim
 * and subsequent API calls succeed.
 *
 * Requires: docker-compose.e2e-closed.yml overlay
 */
describe('Closed mode — tenant resolution', { testIsolation: false }, () => {
  const GROUP_CLAIM = '/e2e-org-alpha';
  const ADMIN_EMAIL = 'e2e-admin@test.local';
  const USER_EMAIL = 'e2e-user@test.local';
  const PASSWORD = 'E2eTest123!';

  before(() => {
    // Clean up any leftover data from previous runs
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_CLAIM });
  });

  after(() => {
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_CLAIM });
  });

  describe('First user sign-in provisions tenant', () => {
    it('admin signs in and can call the API', () => {
      cy.apiLogin(ADMIN_EMAIL, PASSWORD);

      // The sign-in event should have auto-provisioned a tenant from the
      // group claim.  Verify the session works by hitting a protected endpoint.
      cy.request('/api/v1/dids').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
      });
    });

    it('tenant was created with correct externalIdpGroupId', () => {
      cy.task('verifyClosedModeTenant', { externalIdpGroupId: GROUP_CLAIM }).then(
        (tenant: any) => {
          expect(tenant).to.not.be.null;
          expect(tenant.externalIdpGroupId).to.eq(GROUP_CLAIM);
          expect(tenant.name).to.eq('My Organisation');
        },
      );
    });
  });

  describe('Second user joins same tenant', () => {
    it('second user signs in (same group) and can call the API', () => {
      // Clear all cookies to reset both app and Keycloak sessions
      cy.clearAllCookies();

      cy.apiLogin(USER_EMAIL, PASSWORD);

      cy.request('/api/v1/dids').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
      });
    });

    it('both users share the same tenant', () => {
      cy.task('verifyUsersShareTenant', {
        emails: [ADMIN_EMAIL, USER_EMAIL],
      }).then((result: any) => {
        expect(result.sameTenant).to.be.true;
        expect(result.externalIdpGroupId).to.eq(GROUP_CLAIM);
      });
    });
  });
});
