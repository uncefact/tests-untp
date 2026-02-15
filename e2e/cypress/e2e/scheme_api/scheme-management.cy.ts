describe('Scheme API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let registrarId: string;
  let createdSchemeId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // Create a registrar as a prerequisite for schemes
    cy.request({
      method: 'POST',
      url: '/api/v1/registrars',
      body: {
        name: `Scheme Test Registrar ${RUN_ID}`,
        namespace: `scheme-reg-${RUN_ID}`,
        url: `https://scheme-reg-${RUN_ID}.example.com`,
      },
    }).then((response) => {
      registrarId = response.body.registrar.id;
    });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: 'e2e-test-org' });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/schemes — creates a scheme', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `E2E ABN Scheme ${RUN_ID}`,
          primaryKey: `abn-${RUN_ID}`,
          validationPattern: '^\\d{11}$',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.ok).to.be.true;
        expect(response.body.scheme).to.exist;
        expect(response.body.scheme.name).to.eq(`E2E ABN Scheme ${RUN_ID}`);
        expect(response.body.scheme.primaryKey).to.eq(`abn-${RUN_ID}`);
        expect(response.body.scheme.validationPattern).to.eq('^\\d{11}$');
        expect(response.body.scheme.registrarId).to.eq(registrarId);

        createdSchemeId = response.body.scheme.id;
      });
    });

    it('POST /api/v1/schemes — creates a scheme with qualifiers', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `E2E GTIN Scheme ${RUN_ID}`,
          primaryKey: `gtin-${RUN_ID}`,
          validationPattern: '^\\d{14}$',
          qualifiers: [
            {
              key: 'lot',
              description: 'Lot/batch number',
              validationPattern: '^[A-Za-z0-9]+$',
            },
            {
              key: 'serial',
              description: 'Serial number',
              validationPattern: '^[A-Za-z0-9]+$',
            },
          ],
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.scheme.qualifiers).to.be.an('array');
        expect(response.body.scheme.qualifiers).to.have.length(2);

        const keys = response.body.scheme.qualifiers.map((q: any) => q.key);
        expect(keys).to.include('lot');
        expect(keys).to.include('serial');

        // Clean up this scheme — we only need the first one for remaining tests
        cy.request({ method: 'DELETE', url: `/api/v1/schemes/${response.body.scheme.id}` });
      });
    });

    it('GET /api/v1/schemes — lists schemes', () => {
      cy.request('/api/v1/schemes').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.schemes).to.be.an('array');

        const created = response.body.schemes.find(
          (s: any) => s.id === createdSchemeId,
        );
        expect(created).to.exist;
      });
    });

    it('GET /api/v1/schemes — filters by registrarId', () => {
      cy.request(`/api/v1/schemes?registrarId=${registrarId}`).then((response) => {
        expect(response.status).to.eq(200);
        response.body.schemes.forEach((s: any) => {
          expect(s.registrarId).to.eq(registrarId);
        });
      });
    });

    it('GET /api/v1/schemes/:id — retrieves a specific scheme', () => {
      cy.request(`/api/v1/schemes/${createdSchemeId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.scheme.id).to.eq(createdSchemeId);
        expect(response.body.scheme.name).to.eq(`E2E ABN Scheme ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/schemes/:id — updates scheme name', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/schemes/${createdSchemeId}`,
        body: { name: `Updated ABN Scheme ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.scheme.name).to.eq(`Updated ABN Scheme ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/schemes/:id — adds qualifiers via update', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/schemes/${createdSchemeId}`,
        body: {
          qualifiers: [
            {
              key: 'cpv',
              description: 'Consumer product variant',
              validationPattern: '^\\d{2}$',
            },
          ],
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.scheme.qualifiers).to.have.length(1);
        expect(response.body.scheme.qualifiers[0].key).to.eq('cpv');
      });
    });

    it('PATCH /api/v1/schemes/:id — replaces qualifiers on update', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/schemes/${createdSchemeId}`,
        body: {
          qualifiers: [
            {
              key: 'lot',
              description: 'Lot number',
              validationPattern: '^[A-Z0-9]+$',
            },
            {
              key: 'serial',
              description: 'Serial number',
              validationPattern: '^[0-9]+$',
            },
          ],
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        // Previous 'cpv' qualifier should be gone — qualifiers are replaced, not appended
        expect(response.body.scheme.qualifiers).to.have.length(2);
        const keys = response.body.scheme.qualifiers.map((q: any) => q.key);
        expect(keys).to.include('lot');
        expect(keys).to.include('serial');
        expect(keys).to.not.include('cpv');
      });
    });

    it('GET /api/v1/schemes/:id — confirms updates persisted', () => {
      cy.request(`/api/v1/schemes/${createdSchemeId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.scheme.name).to.eq(`Updated ABN Scheme ${RUN_ID}`);
        expect(response.body.scheme.qualifiers).to.have.length(2);
      });
    });

    it('DELETE /api/v1/schemes/:id — deletes the scheme', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/schemes/${createdSchemeId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
      });
    });

    it('GET /api/v1/schemes/:id — returns 404 after deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/schemes/${createdSchemeId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  describe('Pagination', () => {
    it('supports limit and offset parameters', () => {
      cy.request('/api/v1/schemes?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.schemes.length).to.be.at.most(1);
      });
    });
  });

  describe('Validation errors', () => {
    it('returns 400 when registrarId is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: { name: 'Test', primaryKey: 'pk', validationPattern: '.*' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when name is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: { registrarId, primaryKey: 'pk', validationPattern: '.*' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when primaryKey is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: { registrarId, name: 'Test', validationPattern: '.*' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when validationPattern is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: { registrarId, name: 'Test', primaryKey: 'pk' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when qualifier key is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: 'Test',
          primaryKey: `pk-${RUN_ID}`,
          validationPattern: '.*',
          qualifiers: [{ description: 'desc', validationPattern: '.*' }],
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when PATCH body is empty', () => {
      // Create a temp scheme to test PATCH validation
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Temp Scheme ${RUN_ID}`,
          primaryKey: `temp-pk-${RUN_ID}`,
          validationPattern: '.*',
        },
      }).then((createResponse) => {
        const tempId = createResponse.body.scheme.id;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/schemes/${tempId}`,
          body: {},
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
        });

        cy.request({ method: 'DELETE', url: `/api/v1/schemes/${tempId}` });
      });
    });

    it('returns 404 for nonexistent scheme', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/schemes/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/schemes?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });
});
