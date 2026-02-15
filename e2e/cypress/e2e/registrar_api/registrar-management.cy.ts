describe('Registrar API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let createdRegistrarId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });
  });

  after(() => {
    cy.task('cleanupTestData', { organizationId: 'e2e-test-org' });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/registrars — creates a registrar', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/registrars',
        body: {
          name: `E2E Test Registrar ${RUN_ID}`,
          namespace: `e2e-ns-${RUN_ID}`,
          url: `https://registrar-${RUN_ID}.example.com`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.ok).to.be.true;
        expect(response.body.registrar).to.exist;
        expect(response.body.registrar.name).to.eq(`E2E Test Registrar ${RUN_ID}`);
        expect(response.body.registrar.namespace).to.eq(`e2e-ns-${RUN_ID}`);
        expect(response.body.registrar.url).to.eq(`https://registrar-${RUN_ID}.example.com`);

        createdRegistrarId = response.body.registrar.id;
      });
    });

    it('GET /api/v1/registrars — lists registrars', () => {
      cy.request('/api/v1/registrars').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.registrars).to.be.an('array');

        const created = response.body.registrars.find(
          (r: any) => r.id === createdRegistrarId,
        );
        expect(created).to.exist;
      });
    });

    it('GET /api/v1/registrars/:id — retrieves a specific registrar', () => {
      cy.request(`/api/v1/registrars/${createdRegistrarId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.registrar.id).to.eq(createdRegistrarId);
        expect(response.body.registrar.name).to.eq(`E2E Test Registrar ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/registrars/:id — updates registrar name', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/registrars/${createdRegistrarId}`,
        body: { name: `Updated E2E Registrar ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.registrar.name).to.eq(`Updated E2E Registrar ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/registrars/:id — updates namespace and url', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/registrars/${createdRegistrarId}`,
        body: {
          namespace: `updated-ns-${RUN_ID}`,
          url: `https://updated-registrar-${RUN_ID}.example.com`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.registrar.namespace).to.eq(`updated-ns-${RUN_ID}`);
        expect(response.body.registrar.url).to.eq(`https://updated-registrar-${RUN_ID}.example.com`);
      });
    });

    it('GET /api/v1/registrars/:id — confirms updates persisted', () => {
      cy.request(`/api/v1/registrars/${createdRegistrarId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.registrar.name).to.eq(`Updated E2E Registrar ${RUN_ID}`);
        expect(response.body.registrar.namespace).to.eq(`updated-ns-${RUN_ID}`);
      });
    });

    it('DELETE /api/v1/registrars/:id — deletes the registrar', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/registrars/${createdRegistrarId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
      });
    });

    it('GET /api/v1/registrars/:id — returns 404 after deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/registrars/${createdRegistrarId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  describe('Pagination', () => {
    it('supports limit and offset parameters', () => {
      cy.request('/api/v1/registrars?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.registrars.length).to.be.at.most(1);
      });
    });
  });

  describe('Validation errors', () => {
    it('returns 400 when name is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/registrars',
        body: { namespace: 'test', url: 'https://example.com' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when namespace is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/registrars',
        body: { name: 'Test', url: 'https://example.com' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when url is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/registrars',
        body: { name: 'Test', namespace: 'test' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when PATCH body is empty', () => {
      // Create a temporary registrar to test PATCH validation
      cy.request({
        method: 'POST',
        url: '/api/v1/registrars',
        body: {
          name: `Temp Registrar ${RUN_ID}`,
          namespace: `temp-ns-${RUN_ID}`,
          url: `https://temp-${RUN_ID}.example.com`,
        },
      }).then((createResponse) => {
        const tempId = createResponse.body.registrar.id;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/registrars/${tempId}`,
          body: {},
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
        });

        // Clean up
        cy.request({ method: 'DELETE', url: `/api/v1/registrars/${tempId}` });
      });
    });

    it('returns 404 for nonexistent registrar', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/registrars/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/registrars?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/registrars?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });
});
