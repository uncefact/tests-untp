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
  // Import & Browse
  // -----------------------------------------------------------------------
  describe('Import & Browse', () => {
    it('POST /api/v1/cvc/catalogues — imports a catalogue from a remote URL', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: {
          url: 'https://vocab.deploy2cloud.com.au',
          version: 'v0.6.1',
        },
        timeout: 30000,
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.catalogue).to.exist;
        expect(response.body.catalogue.name).to.exist;
        expect(response.body.summary).to.exist;
        expect(response.body.summary.schemes).to.be.at.least(1);
        expect(response.body.summary.profiles).to.be.at.least(1);
        expect(response.body.summary.criteria).to.be.at.least(1);

        catalogueId = response.body.catalogue.id;
      });
    });

    it('GET /api/v1/cvc/catalogues — lists catalogues', () => {
      cy.request('/api/v1/cvc/catalogues').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.at.least(1);

        const imported = response.body.data.find(
          (c: any) => c.id === catalogueId,
        );
        expect(imported).to.exist;
      });
    });

    it('GET /api/v1/cvc/catalogues/:id — retrieves the imported catalogue', () => {
      cy.request(`/api/v1/cvc/catalogues/${catalogueId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(catalogueId);
        expect(response.body.name).to.exist;
        expect(response.body.sourceUrl).to.eq('https://vocab.deploy2cloud.com.au');
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
        expect(response.body.data.length).to.be.at.least(1);

        schemeId = response.body.data[0].id;
      });
    });

    it('GET /api/v1/cvc/schemes/:id — retrieves the scheme detail', () => {
      cy.request(`/api/v1/cvc/schemes/${schemeId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(schemeId);
        expect(response.body.profiles).to.be.an('array');
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
        expect(response.body.data.length).to.be.at.least(1);

        profileId = response.body.data[0].id;
      });
    });

    it('GET /api/v1/cvc/profiles/:id — retrieves the profile detail', () => {
      cy.request(`/api/v1/cvc/profiles/${profileId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(profileId);
        expect(response.body.criteria).to.be.an('array');
      });
    });

    it('GET /api/v1/cvc/criteria — lists all criteria (unfiltered)', () => {
      cy.request('/api/v1/cvc/criteria').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.at.least(1);
        expect(response.body.pagination).to.exist;
      });
    });

    it('GET /api/v1/cvc/criteria?profileId=X — lists criteria for the profile', () => {
      cy.request(`/api/v1/cvc/criteria?profileId=${profileId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.at.least(1);

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
  // Re-import
  // -----------------------------------------------------------------------
  describe('Re-import', () => {
    it('POST /api/v1/cvc/catalogues — re-importing the same URL/version replaces the catalogue', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: {
          url: 'https://vocab.deploy2cloud.com.au',
          version: 'v0.6.1',
        },
        timeout: 30000,
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.catalogue).to.exist;
        expect(response.body.summary).to.exist;
        expect(response.body.summary.schemes).to.be.at.least(1);

        // Update catalogueId in case it changed on re-import
        catalogueId = response.body.catalogue.id;
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
        body: { version: 'v0.6.1' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('POST /api/v1/cvc/catalogues — returns 400 when version is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: { url: 'https://vocab.deploy2cloud.com.au' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('POST /api/v1/cvc/catalogues — returns 400 for an invalid URL', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: { url: 'not-a-valid-url', version: 'v0.6.1' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('POST /api/v1/cvc/catalogues — returns 400 for unsupported CVC version', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: { url: 'https://vocab.deploy2cloud.com.au', version: 'v99.0.0' },
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

    it('POST /api/v1/cvc/catalogues — returns 500 for unreachable URL', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/cvc/catalogues',
        body: { url: 'https://this-domain-does-not-exist-12345.example.com', version: 'v0.6.1' },
        failOnStatusCode: false,
        timeout: 30000,
      }).then((response) => {
        expect(response.status).to.eq(500);
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
