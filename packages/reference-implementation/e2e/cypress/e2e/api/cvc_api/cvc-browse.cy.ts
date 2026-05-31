import { config } from '../../../support/config';

/**
 * Conformity Vocabulary Catalogue browse API (E2E).
 *
 * Seeds a scheme -> profile -> criterion graph for the test tenant, then drills
 * through the three browse endpoints the way an issuer's pickers would, checking
 * each seeded entry comes back by its canonical URI and that the criterion's
 * topics survive the round-trip. The seeded rows are owned by the test tenant,
 * so the standard tenant cleanup removes them.
 */
describe('Conformity Vocabulary browse API', { testIsolation: false }, () => {
  let testTenantId: string;
  let scheme: string;
  let profile: string;
  let criterion: string;
  let topic: string;

  before(() => {
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });
    cy.task('cleanupTestUsers', { emails: [config.user.email] });

    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: config.user.email }).then((result) => {
      testTenantId = (result as { tenantId: string }).tenantId;
      cy.task('seedConformitySchemes', { tenantId: testTenantId }).then((seeded) => {
        const s = seeded as { scheme: string; profile: string; criterion: string; topic: string };
        scheme = s.scheme;
        profile = s.profile;
        criterion = s.criterion;
        topic = s.topic;
      });
    });
  });

  after(() => {
    const preserveTenant = config.tenantMode === 'closed';
    if (testTenantId) {
      cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
    }
  });

  it('GET /api/v1/cvc/schemes — returns the seeded scheme by its canonical URI', () => {
    cy.request({ method: 'GET', url: '/api/v1/cvc/schemes' }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body).to.not.have.property('ok');
      expect(res.body.pagination.hasMore).to.be.a('boolean');
      const ids = (res.body.data as Array<{ id: string }>).map((entry) => entry.id);
      expect(ids).to.include(scheme);
    });
  });

  it("GET /api/v1/cvc/profiles?schemeId — returns the chosen scheme's profiles", () => {
    cy.request({ method: 'GET', url: `/api/v1/cvc/profiles?schemeId=${encodeURIComponent(scheme)}` }).then((res) => {
      expect(res.status).to.eq(200);
      const ids = (res.body.data as Array<{ id: string }>).map((entry) => entry.id);
      expect(ids).to.include(profile);
    });
  });

  it("GET /api/v1/cvc/criteria?profileId — returns the chosen profile's criteria with their topics", () => {
    cy.request({ method: 'GET', url: `/api/v1/cvc/criteria?profileId=${encodeURIComponent(profile)}` }).then((res) => {
      expect(res.status).to.eq(200);
      const found = (
        res.body.data as Array<{ id: string; topics: Array<{ canonicalId: string }>; tags: string[] }>
      ).find((entry) => entry.id === criterion);
      expect(found, 'seeded criterion is present').to.exist;
      expect(found!.topics).to.deep.include({ canonicalId: topic });
      expect(found!.tags).to.include('e2e');
    });
  });
});
