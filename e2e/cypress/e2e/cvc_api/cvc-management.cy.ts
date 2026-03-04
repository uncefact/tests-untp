describe('CVC API', { testIsolation: false }, () => {
  let catalogueId: string;
  let schemeId: string;
  let profileId: string;
  let criterionId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: 'e2e-test-org' });
  });

  // -----------------------------------------------------------------------
  // Seed & Browse
  // -----------------------------------------------------------------------
  describe('Seed & Browse', () => {
    it('seeds a CVC catalogue via task', () => {
      cy.task('seedCvcCatalogue', { tenantId: 'e2e-test-org' }).then((result: any) => {
        expect(result.catalogueId).to.be.a('string');
        expect(result.schemeId).to.be.a('string');
        expect(result.profileId).to.be.a('string');
        expect(result.criterionIds).to.be.an('array').with.length(2);

        catalogueId = result.catalogueId;
        schemeId = result.schemeId;
        profileId = result.profileId;
        criterionId = result.criterionIds[0];
      });
    });

    it('GET /api/v1/cvc/catalogues — lists catalogues', () => {
      cy.request('/api/v1/cvc/catalogues').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.at.least(1);

        const seeded = response.body.data.find(
          (c: any) => c.id === catalogueId,
        );
        expect(seeded).to.exist;
      });
    });

    it('GET /api/v1/cvc/catalogues/:id — retrieves the catalogue', () => {
      cy.request(`/api/v1/cvc/catalogues/${catalogueId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(catalogueId);
        expect(response.body.name).to.eq('E2E Test Catalogue');
        expect(response.body.sourceUrl).to.eq('https://example.com/e2e-cvc');
      });
    });

    it('GET /api/v1/cvc/schemes — lists all schemes (unfiltered)', () => {
      cy.request('/api/v1/cvc/schemes').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.at.least(1);
        expect(response.body.pagination).to.exist;
      });
    });

    it('GET /api/v1/cvc/schemes?catalogueId=X — lists schemes for the catalogue', () => {
      cy.request(`/api/v1/cvc/schemes?catalogueId=${catalogueId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.eq(1);
        expect(response.body.data[0].id).to.eq(schemeId);
      });
    });

    it('GET /api/v1/cvc/schemes/:id — retrieves the scheme detail', () => {
      cy.request(`/api/v1/cvc/schemes/${schemeId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(schemeId);
        expect(response.body.profiles).to.be.an('array').with.length(1);
      });
    });

    it('GET /api/v1/cvc/profiles — lists all profiles (unfiltered)', () => {
      cy.request('/api/v1/cvc/profiles').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.at.least(1);
        expect(response.body.pagination).to.exist;
      });
    });

    it('GET /api/v1/cvc/profiles?schemeId=X — lists profiles for the scheme', () => {
      cy.request(`/api/v1/cvc/profiles?schemeId=${schemeId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.eq(1);
        expect(response.body.data[0].id).to.eq(profileId);
      });
    });

    it('GET /api/v1/cvc/profiles/:id — retrieves the profile detail with criteria', () => {
      cy.request(`/api/v1/cvc/profiles/${profileId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(profileId);
        expect(response.body.criteria).to.be.an('array').with.length(2);
      });
    });

    it('GET /api/v1/cvc/criteria — lists all criteria (unfiltered)', () => {
      cy.request('/api/v1/cvc/criteria').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.at.least(2);
        expect(response.body.pagination).to.exist;
      });
    });

    it('GET /api/v1/cvc/criteria?profileId=X — lists criteria for the profile', () => {
      cy.request(`/api/v1/cvc/criteria?profileId=${profileId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.eq(2);

        criterionId = response.body.data[0].id;
      });
    });

    it('GET /api/v1/cvc/criteria/:id — retrieves the criterion detail', () => {
      cy.request(`/api/v1/cvc/criteria/${criterionId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(criterionId);
        expect(response.body.name).to.exist;
      });
    });
  });

  // -----------------------------------------------------------------------
  // Delete & Confirm
  // -----------------------------------------------------------------------
  describe('Delete & Confirm', () => {
    it('DELETE /api/v1/cvc/catalogues/:id — deletes the catalogue', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/cvc/catalogues/${catalogueId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
      });
    });

    it('GET /api/v1/cvc/catalogues/:id — returns 404 after deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/cvc/catalogues/${catalogueId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('GET /api/v1/cvc/schemes/:id — confirms schemes are gone after catalogue deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/cvc/schemes/${schemeId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('DELETE /api/v1/cvc/catalogues/:id — returns 404 for already-deleted catalogue', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/cvc/catalogues/${catalogueId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Validation errors
  // -----------------------------------------------------------------------
  describe('Validation errors', () => {
    it('POST /api/v1/cvc/catalogues — returns 400 when url is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: { version: '0.7.0' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('POST /api/v1/cvc/catalogues — returns 400 when version is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: { url: 'https://example.com/some-cvc' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('POST /api/v1/cvc/catalogues — returns 400 for an invalid URL', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: { url: 'not-a-valid-url', version: '0.7.0' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('POST /api/v1/cvc/catalogues — returns 400 for unsupported CVC version', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: { url: 'https://example.com/some-cvc', version: 'v99.0.0' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('Unsupported CVC version');
      });
    });

    it('POST /api/v1/cvc/catalogues — returns 400 for empty body', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: {},
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('POST /api/v1/cvc/catalogues — returns 400 for unreachable URL', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: { url: 'https://this-domain-does-not-exist-12345.example.com', version: '0.7.0' },
        failOnStatusCode: false,
        timeout: 30000,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('DELETE /api/v1/cvc/catalogues/:id — returns 404 for nonexistent catalogue', () => {
      cy.request({
        method: 'DELETE',
        url: '/api/v1/cvc/catalogues/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('GET /api/v1/cvc/catalogues — returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/cvc/catalogues?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('GET /api/v1/cvc/catalogues — returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/cvc/catalogues?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('GET /api/v1/cvc/catalogues/:id — returns 404 for nonexistent catalogue', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/cvc/catalogues/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('GET /api/v1/cvc/schemes/:id — returns 404 for nonexistent scheme', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/cvc/schemes/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('GET /api/v1/cvc/profiles/:id — returns 404 for nonexistent profile', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/cvc/profiles/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('GET /api/v1/cvc/criteria/:id — returns 404 for nonexistent criterion', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/cvc/criteria/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('GET /api/v1/cvc/schemes — returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/cvc/schemes?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('GET /api/v1/cvc/profiles — returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/cvc/profiles?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('GET /api/v1/cvc/criteria — returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/cvc/criteria?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Pagination
  // -----------------------------------------------------------------------
  describe('Pagination', () => {
    before(() => {
      // Re-seed so pagination tests have data (previous section deleted it)
      cy.task('seedCvcCatalogue', { tenantId: 'e2e-test-org' }).then((result: any) => {
        catalogueId = result.catalogueId;
      });
    });

    it('GET /api/v1/cvc/catalogues — supports limit and offset parameters', () => {
      cy.request('/api/v1/cvc/catalogues?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data.length).to.be.at.most(1);
        expect(response.body.pagination).to.exist;
        expect(response.body.pagination.limit).to.eq(1);
      });
    });
  });
});
