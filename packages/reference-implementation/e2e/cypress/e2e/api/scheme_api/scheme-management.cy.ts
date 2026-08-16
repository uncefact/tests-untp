import { config } from '../../../support/config';

describe('Scheme API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let registrarId: string;
  let createdSchemeId: string;
  let testTenantId: string;

  before(() => {
    // Clean up any stale data from a previous failed run
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });
    cy.task('cleanupTestUsers', { emails: [config.user.email, config.user2.email] });

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
        expect(response.body).to.not.have.property('ok');
        expect(response.body.data).to.be.an('array');
        expect(response.body.pagination).to.exist;

        const created = response.body.data.find((s: any) => s.id === createdSchemeId);
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
        expect(response.body.pagination.limit).to.eq(1);
        expect(response.body.pagination.offset).to.eq(0);
        expect(response.body.pagination.hasMore).to.be.a('boolean');
      });
    });
  });

  describe('Validation errors', () => {
    // Each case owns its fixture: the shared scheme is deleted by the CRUD
    // block that created it, well before this block runs. Ids are removed in
    // afterEach rather than inline, so a failing assertion still cleans up.
    // Cypress abandons the remaining command queue on failure, and a retry
    // would otherwise re-POST the same primaryKey and hit the uniqueness
    // constraint, reporting a 409 in place of the original failure.
    const createdIds: string[] = [];

    afterEach(() => {
      while (createdIds.length > 0) {
        const id = createdIds.pop();
        cy.request({ method: 'DELETE', url: `/api/v1/schemes/${id}`, failOnStatusCode: false });
      }
    });

    const createTempScheme = (slug: string, overrides: Record<string, unknown> = {}) =>
      cy
        .request({
          method: 'POST',
          url: '/api/v1/schemes',
          body: {
            registrarId,
            name: `Temp Scheme ${slug} ${RUN_ID}`,
            primaryKey: `temp-${slug}-${RUN_ID}`,
            validationPattern: '.*',
            linkTemplate: '/{primaryKey}/{value}',
            ...overrides,
          },
        })
        .then((response) => {
          expect(response.status).to.eq(201);
          createdIds.push(response.body.id);
          return response.body.id as string;
        });

    it('returns 400 when registrarId is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: { name: 'Test', primaryKey: 'pk', validationPattern: '.*' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
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
        expect(response.body.error).to.be.a('string');
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
        expect(response.body.error).to.be.a('string');
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
        expect(response.body.error).to.be.a('string');
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
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 for invalid JSON body', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: 'not valid json',
        headers: { 'Content-Type': 'application/json' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 404 when POST references nonexistent registrarId', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId: 'nonexistent-id',
          name: 'Test',
          primaryKey: `pk-nonexistent-${RUN_ID}`,
          validationPattern: '.*',
          linkTemplate: '/{primaryKey}/{value}',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 when PATCH body is empty', () => {
      createTempScheme('empty-patch').then((tempId) => {
        cy.request({
          method: 'PATCH',
          url: `/api/v1/schemes/${tempId}`,
          body: {},
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
          expect(response.body.error).to.be.a('string');
        });
      });
    });

    it('returns 404 for nonexistent scheme', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/schemes/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('PATCH — returns 404 for nonexistent scheme', () => {
      cy.request({
        method: 'PATCH',
        url: '/api/v1/schemes/nonexistent-id',
        body: { name: 'Should not work' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('DELETE — returns 404 for nonexistent scheme', () => {
      cy.request({
        method: 'DELETE',
        url: '/api/v1/schemes/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/schemes?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/schemes?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    // The maximum is resolved at startup from API_MAX_PAGE_LIMIT and defaults
    // to 100; the e2e stack leaves the variable unset, so the default applies.
    it('returns 400 when limit exceeds the maximum page size', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/schemes?limit=101',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.contain('limit');
        expect(response.body.error).to.contain('100');
      });
    });

    // The value is deliberately within the permitted range once parsed (1e1 is
    // 10), so only the strict decimal-integer check can reject it. An
    // out-of-range value such as 1e3 would also be rejected by the maximum
    // bound, leaving the test green even if scientific notation became
    // acceptable.
    it('returns 400 for a limit in scientific notation', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/schemes?limit=1e1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.contain('limit');
        expect(response.body.error).to.contain('positive integer');
      });
    });

    it('returns 400 when a PATCH body carries only unrecognised keys', () => {
      createTempScheme('unknown-keys').then((tempId) => {
        cy.request({
          method: 'PATCH',
          url: `/api/v1/schemes/${tempId}`,
          body: { nmae: 'typo', unknownField: true },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
          expect(response.body.error).to.contain('At least one field is required');
        });
      });
    });

    it('returns 400 for a non-integer qualifier order', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Fractional Order ${RUN_ID}`,
          primaryKey: `frac-order-${RUN_ID}`,
          validationPattern: '.*',
          linkTemplate: '/{primaryKey}/{value}',
          qualifiers: [{ key: 'lot', description: 'Lot', validationPattern: '.*', order: 1.5 }],
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.contain('qualifiers.0.order');
      });
    });

    // The column is a Postgres int4, so a value above its range is rejected at
    // the boundary rather than reaching the database as a 500.
    it('returns 400 for a qualifier order beyond the 32-bit range', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Overflow Order ${RUN_ID}`,
          primaryKey: `overflow-order-${RUN_ID}`,
          validationPattern: '.*',
          linkTemplate: '/{primaryKey}/{value}',
          qualifiers: [{ key: 'lot', description: 'Lot', validationPattern: '.*', order: 2147483648 }],
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.contain('qualifiers.0.order');
      });
    });

    // Zero is the first resolution position, so it must survive the lower bound
    // on order. This proves zero is accepted and read back; it cannot prove the
    // stored value came from the request, because the column defaults to zero
    // too. That distinction is asserted where it is observable, in the route's
    // own test against the repository call.
    it('accepts a qualifier order of zero and reads it back', () => {
      const qualifiers = [{ key: 'lot', description: 'Lot', validationPattern: '.*', order: 0 }];

      createTempScheme('zero-order', { qualifiers }).then((tempId) => {
        cy.request(`/api/v1/schemes/${tempId}`).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.qualifiers).to.have.length(1);
          expect(response.body.qualifiers[0].order).to.eq(0);
        });
      });
    });

    it('returns 400 for a negative qualifier order', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Negative Order ${RUN_ID}`,
          primaryKey: `negative-order-${RUN_ID}`,
          validationPattern: '.*',
          linkTemplate: '/{primaryKey}/{value}',
          qualifiers: [{ key: 'lot', description: 'Lot', validationPattern: '.*', order: -1 }],
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.contain('qualifiers.0.order');
      });
    });

    it('returns 400 for a validationPattern that is not a valid regular expression', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Bad Pattern ${RUN_ID}`,
          primaryKey: `bad-pattern-${RUN_ID}`,
          validationPattern: '[unclosed',
          linkTemplate: '/{primaryKey}/{value}',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.contain('validationPattern');
      });
    });
  });
});
