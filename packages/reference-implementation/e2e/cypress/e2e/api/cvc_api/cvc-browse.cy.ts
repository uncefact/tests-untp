/**
 * Conformity Vocabulary Catalogue browse API (E2E).
 *
 * The catalogue has read routes only: no API creates or removes a scheme,
 * profile or criterion, so this spec cannot own a fixture the way the other
 * API specs do. It exercises the browse contract against whatever the
 * instance holds: the list shapes and pagination, the required parent
 * filters, and the drill-through from a scheme to its profiles and criteria
 * when the instance has any. Seeding catalogue entries through an API is
 * tracked as follow-up work; until then the drill-through is the shape of
 * the instance's own catalogue, not a seeded graph.
 */
describe('Conformity Vocabulary browse API', { testIsolation: false }, () => {
  before(() => {
    cy.apiLogin();
  });

  it('GET /api/v1/cvc/schemes: lists schemes with the standard envelope', () => {
    cy.request({ method: 'GET', url: '/api/v1/cvc/schemes' }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body).to.not.have.property('ok');
      expect(res.body.data).to.be.an('array');
      expect(res.body.pagination.hasMore).to.be.a('boolean');
      for (const entry of res.body.data as Array<Record<string, unknown>>) {
        expect(entry.id, 'every scheme names its canonical id').to.be.a('string');
      }
    });
  });

  it('GET /api/v1/cvc/profiles: requires a schemeId and answers an unknown scheme with no profiles', () => {
    cy.request({ method: 'GET', url: '/api/v1/cvc/profiles', failOnStatusCode: false }).then((res) => {
      expect(res.status).to.eq(400);
      expect(res.body.error).to.be.a('string');
    });
    cy.request({
      method: 'GET',
      url: `/api/v1/cvc/profiles?schemeId=${encodeURIComponent('https://example.invalid/e2e-unknown-scheme')}`,
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.data).to.deep.eq([]);
    });
  });

  it('GET /api/v1/cvc/criteria: requires a profileId and answers an unknown profile with no criteria', () => {
    cy.request({ method: 'GET', url: '/api/v1/cvc/criteria', failOnStatusCode: false }).then((res) => {
      expect(res.status).to.eq(400);
      expect(res.body.error).to.be.a('string');
    });
    cy.request({
      method: 'GET',
      url: `/api/v1/cvc/criteria?profileId=${encodeURIComponent('https://example.invalid/e2e-unknown-profile')}`,
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.data).to.deep.eq([]);
    });
  });

  it("drills from each scheme on the first page into its profiles and each profile's criteria", () => {
    cy.request({ method: 'GET', url: '/api/v1/cvc/schemes' }).then((schemes) => {
      const schemeIds = (schemes.body.data as Array<{ id: string }>).map((entry) => entry.id);
      cy.log(`${schemeIds.length} scheme(s) held by this instance`);
      cy.wrap(schemeIds).each((schemeId: string) => {
        cy.request({ method: 'GET', url: `/api/v1/cvc/profiles?schemeId=${encodeURIComponent(schemeId)}` }).then(
          (profiles) => {
            expect(profiles.status).to.eq(200);
            expect(profiles.body.data).to.be.an('array');
            cy.wrap((profiles.body.data as Array<{ id: string }>).map((entry) => entry.id)).each(
              (profileId: string) => {
                cy.request({
                  method: 'GET',
                  url: `/api/v1/cvc/criteria?profileId=${encodeURIComponent(profileId)}`,
                }).then((criteria) => {
                  expect(criteria.status).to.eq(200);
                  for (const criterion of criteria.body.data as Array<{ id: string; topics: unknown }>) {
                    expect(criterion.id).to.be.a('string');
                    expect(criterion.topics, 'a criterion carries its topics').to.be.an('array');
                  }
                });
              },
            );
          },
        );
      });
    });
  });
});
