describe('Organisation API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let registrarId: string;
  let schemeId: string;
  let identifierId: string;
  let secondaryIdentifierId: string;
  let createdOrgId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // Create prerequisite registrar → scheme → 2 identifiers chain
    cy.request({
      method: 'POST',
      url: '/api/v1/registrars',
      body: {
        name: `Org Test Registrar ${RUN_ID}`,
        namespace: `org-reg-${RUN_ID}`,
        url: `https://org-reg-${RUN_ID}.example.com`,
      },
    }).then((regResponse) => {
      registrarId = regResponse.body.registrar.id;

      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Org Test ABN Scheme ${RUN_ID}`,
          primaryKey: `abn-${RUN_ID}`,
          validationPattern: '^\\d{11}$',
          linkTemplate: '/{primaryKey}/{value}',
        },
      }).then((schemeResponse) => {
        schemeId = schemeResponse.body.scheme.id;

        // Create primary identifier
        cy.request({
          method: 'POST',
          url: '/api/v1/identifiers',
          body: {
            schemeId,
            value: '11111111111',
          },
        }).then((identResponse) => {
          identifierId = identResponse.body.identifier.id;
        });

        // Create secondary identifier
        cy.request({
          method: 'POST',
          url: '/api/v1/identifiers',
          body: {
            schemeId,
            value: '22222222222',
          },
        }).then((secIdentResponse) => {
          secondaryIdentifierId = secIdentResponse.body.identifier.id;
        });
      });
    });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: 'e2e-test-org' });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/organisations — creates organisations', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/organisations',
        body: [
          {
            name: `Test Organisation ${RUN_ID}`,
          },
        ],
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.organisations).to.be.an('array');
        expect(response.body.organisations).to.have.length(1);
        expect(response.body.organisations[0].name).to.eq(
          `Test Organisation ${RUN_ID}`,
        );

        createdOrgId = response.body.organisations[0].id;
      });
    });

    it('GET /api/v1/organisations — lists organisations', () => {
      cy.request('/api/v1/organisations').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.organisations).to.be.an('array');

        const created = response.body.organisations.find(
          (o: any) => o.id === createdOrgId,
        );
        expect(created).to.exist;
      });
    });

    it('GET /api/v1/organisations — filters by search', () => {
      cy.request(
        `/api/v1/organisations?search=Test Organisation ${RUN_ID}`,
      ).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.organisations).to.be.an('array');
        expect(response.body.organisations.length).to.be.greaterThan(0);

        response.body.organisations.forEach((o: any) => {
          expect(o.name).to.include(`${RUN_ID}`);
        });
      });
    });

    it('GET /api/v1/organisations/:id — retrieves specific organisation', () => {
      cy.request(`/api/v1/organisations/${createdOrgId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.organisation).to.exist;
        expect(response.body.organisation.id).to.eq(createdOrgId);
        expect(response.body.organisation.name).to.eq(
          `Test Organisation ${RUN_ID}`,
        );
      });
    });

    it('PATCH /api/v1/organisations/:id — updates name', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/organisations/${createdOrgId}`,
        body: { name: `Updated Organisation ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.organisation.name).to.eq(
          `Updated Organisation ${RUN_ID}`,
        );
      });
    });

    it('GET /api/v1/organisations/:id — confirms update persisted', () => {
      cy.request(`/api/v1/organisations/${createdOrgId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.organisation.name).to.eq(
          `Updated Organisation ${RUN_ID}`,
        );
      });
    });

    it('PATCH /api/v1/organisations/:id — assigns primary identifier', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/organisations/${createdOrgId}`,
        body: { primaryIdentifierId: identifierId },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.organisation.primaryIdentifierId).to.eq(
          identifierId,
        );
      });
    });

    it('PATCH /api/v1/organisations/:id — assigns secondary identifiers', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/organisations/${createdOrgId}`,
        body: { secondaryIdentifierIds: [secondaryIdentifierId] },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.organisation).to.exist;
      });
    });

    it('GET /api/v1/organisations/:id — confirms identifiers assigned', () => {
      cy.request(`/api/v1/organisations/${createdOrgId}`).then((response) => {
        expect(response.status).to.eq(200);

        const org = response.body.organisation;
        expect(org.primaryIdentifier).to.exist;
        expect(org.primaryIdentifier.id).to.eq(identifierId);
        expect(org.secondaryIdentifiers).to.be.an('array');
        expect(org.secondaryIdentifiers).to.have.length(1);
        expect(org.secondaryIdentifiers[0].identifier.id).to.eq(secondaryIdentifierId);
      });
    });

    it('PATCH /api/v1/organisations/:id — clears secondary identifiers', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/organisations/${createdOrgId}`,
        body: { secondaryIdentifierIds: [] },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.organisation).to.exist;
      });
    });

    it('DELETE /api/v1/organisations/:id — deletes the organisation', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/organisations/${createdOrgId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.deep.eq({});
      });
    });

    it('GET /api/v1/organisations/:id — returns 404 after deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/organisations/${createdOrgId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  describe('Validation', () => {
    it('returns 400 when name is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/organisations',
        body: [{}],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when body is not an array', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/organisations',
        body: { name: `Invalid Organisation ${RUN_ID}` },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when body is an empty array', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/organisations',
        body: [],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 404 for nonexistent organisation', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/organisations/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/organisations?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/organisations?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });

  describe('Pagination', () => {
    it('supports limit and offset parameters', () => {
      cy.request('/api/v1/organisations?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.organisations.length).to.be.at.most(1);
      });
    });
  });
});
