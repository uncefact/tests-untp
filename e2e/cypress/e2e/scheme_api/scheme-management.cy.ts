import { config } from '../../support/config';

describe('Scheme API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let registrarId: string;
  let createdSchemeId: string;
  let testTenantId: string;

  before(() => {
    // Clean up any stale data from a previous failed run
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });

    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: config.user.email }).then((result: any) => {
      testTenantId = result.tenantId;
    });

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
      registrarId = response.body.id;
    });
  });

  after(() => {
    const preserveTenant = config.tenantMode === 'closed';
    cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
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
          linkTemplate: '/{primaryKey}/{value}',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.name).to.eq(`E2E ABN Scheme ${RUN_ID}`);
        expect(response.body.primaryKey).to.eq(`abn-${RUN_ID}`);
        expect(response.body.validationPattern).to.eq('^\\d{11}$');
        expect(response.body.registrarId).to.eq(registrarId);

        createdSchemeId = response.body.id;
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
          linkTemplate: '/{primaryKey}/{value}',
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
        expect(response.body.qualifiers).to.be.an('array');
        expect(response.body.qualifiers).to.have.length(2);

        const keys = response.body.qualifiers.map((q: any) => q.key);
        expect(keys).to.include('lot');
        expect(keys).to.include('serial');

        // Clean up this scheme — we only need the first one for remaining tests
        cy.request({ method: 'DELETE', url: `/api/v1/schemes/${response.body.id}` });
      });
    });

    it('GET /api/v1/schemes — lists schemes', () => {
      cy.request('/api/v1/schemes').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.pagination).to.exist;

        const created = response.body.data.find(
          (s: any) => s.id === createdSchemeId,
        );
        expect(created).to.exist;
      });
    });

    it('GET /api/v1/schemes — filters by registrarId', () => {
      cy.request(`/api/v1/schemes?registrarId=${registrarId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.pagination).to.exist;
        response.body.data.forEach((s: any) => {
          expect(s.registrarId).to.eq(registrarId);
        });
      });
    });

    it('GET /api/v1/schemes/:id — retrieves a specific scheme', () => {
      cy.request(`/api/v1/schemes/${createdSchemeId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(createdSchemeId);
        expect(response.body.name).to.eq(`E2E ABN Scheme ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/schemes/:id — updates scheme name', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/schemes/${createdSchemeId}`,
        body: { name: `Updated ABN Scheme ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`Updated ABN Scheme ${RUN_ID}`);
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
        expect(response.body.qualifiers).to.have.length(1);
        expect(response.body.qualifiers[0].key).to.eq('cpv');
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
        expect(response.body.qualifiers).to.have.length(2);
        const keys = response.body.qualifiers.map((q: any) => q.key);
        expect(keys).to.include('lot');
        expect(keys).to.include('serial');
        expect(keys).to.not.include('cpv');
      });
    });

    it('GET /api/v1/schemes/:id — confirms updates persisted', () => {
      cy.request(`/api/v1/schemes/${createdSchemeId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`Updated ABN Scheme ${RUN_ID}`);
        expect(response.body.qualifiers).to.have.length(2);
      });
    });

    it('DELETE /api/v1/schemes/:id — deletes the scheme', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/schemes/${createdSchemeId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
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
        expect(response.body.data.length).to.be.at.most(1);
        expect(response.body.pagination).to.exist;
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
          linkTemplate: '/{primaryKey}/{value}',
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
          linkTemplate: '/{primaryKey}/{value}',
        },
      }).then((createResponse) => {
        const tempId = createResponse.body.id;

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
