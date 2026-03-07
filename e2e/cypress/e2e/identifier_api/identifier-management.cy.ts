describe('Identifier API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let registrarId: string;
  let schemeId: string;
  let createdIdentifierId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // Create prerequisite registrar → scheme chain
    cy.request({
      method: 'POST',
      url: '/api/v1/registrars',
      body: {
        name: `Ident Test Registrar ${RUN_ID}`,
        namespace: `ident-reg-${RUN_ID}`,
        url: `https://ident-reg-${RUN_ID}.example.com`,
      },
    }).then((regResponse) => {
      registrarId = regResponse.body.id;

      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Ident Test ABN Scheme ${RUN_ID}`,
          primaryKey: `abn-${RUN_ID}`,
          validationPattern: '^\\d{11}$',
          linkTemplate: '/{primaryKey}/{value}',
        },
      }).then((schemeResponse) => {
        schemeId = schemeResponse.body.id;
      });
    });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: 'e2e-test-org' });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/identifiers — creates an identifier', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/identifiers',
        body: {
          schemeId,
          value: '51824753556',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.value).to.eq('51824753556');
        expect(response.body.schemeId).to.eq(schemeId);

        createdIdentifierId = response.body.id;
      });
    });

    it('GET /api/v1/identifiers — lists identifiers', () => {
      cy.request('/api/v1/identifiers').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.pagination).to.exist;

        const created = response.body.data.find(
          (i: any) => i.id === createdIdentifierId,
        );
        expect(created).to.exist;
      });
    });

    it('GET /api/v1/identifiers — filters by schemeId', () => {
      cy.request(`/api/v1/identifiers?schemeId=${schemeId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.pagination).to.exist;
        response.body.data.forEach((i: any) => {
          expect(i.schemeId).to.eq(schemeId);
        });
      });
    });

    it('GET /api/v1/identifiers/:id — retrieves a specific identifier', () => {
      cy.request(`/api/v1/identifiers/${createdIdentifierId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(createdIdentifierId);
        expect(response.body.value).to.eq('51824753556');
      });
    });

    it('PATCH /api/v1/identifiers/:id — updates identifier value', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/identifiers/${createdIdentifierId}`,
        body: { value: '12345678901' },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.value).to.eq('12345678901');
      });
    });

    it('GET /api/v1/identifiers/:id — confirms update persisted', () => {
      cy.request(`/api/v1/identifiers/${createdIdentifierId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.value).to.eq('12345678901');
      });
    });

    it('DELETE /api/v1/identifiers/:id — deletes the identifier', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/identifiers/${createdIdentifierId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
      });
    });

    it('GET /api/v1/identifiers/:id — returns 404 after deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/identifiers/${createdIdentifierId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  describe('Validation', () => {
    it('returns 400 when schemeId is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/identifiers',
        body: { value: '51824753556' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when value is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/identifiers',
        body: { schemeId },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when value does not match scheme pattern', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/identifiers',
        body: { schemeId, value: 'not-a-number' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when PATCH value does not match scheme pattern', () => {
      // Create a valid identifier first
      cy.request({
        method: 'POST',
        url: '/api/v1/identifiers',
        body: { schemeId, value: '99988877766' },
      }).then((createResponse) => {
        const tempId = createResponse.body.id;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/identifiers/${tempId}`,
          body: { value: 'invalid' },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
        });

        cy.request({ method: 'DELETE', url: `/api/v1/identifiers/${tempId}` });
      });
    });

    it('returns 404 for nonexistent identifier', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/identifiers/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/identifiers?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/identifiers?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });

  describe('Pagination', () => {
    it('supports limit and offset parameters', () => {
      cy.request('/api/v1/identifiers?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data.length).to.be.at.most(1);
        expect(response.body.pagination).to.exist;
      });
    });
  });
});
