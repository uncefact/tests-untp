import { config } from '../../../support/config';

describe('Facility API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let testTenantId: string;
  let registrarId: string;
  let schemeId: string;
  let identifierId: string;
  let secondaryIdentifierId: string;
  let organisationId: string;
  let createdFacilityId: string;

  before(() => {
    // Clean up any stale data from a previous failed run
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });
    cy.task('cleanupTestUsers', { emails: [config.user.email, config.user2.email] });

    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: config.user.email }).then((result: any) => {
      testTenantId = result.tenantId;
    });

    // Create prerequisite chain:
    // 1. registrar -> scheme -> 2 identifiers (primary + secondary)
    // 2. organisation (for operatingOrganisationId)
    cy.request({
      method: 'POST',
      url: '/api/v1/registrars',
      body: {
        name: `Fac Test Registrar ${RUN_ID}`,
        namespace: `fac-reg-${RUN_ID}`,
        url: `https://fac-reg-${RUN_ID}.example.com`,
      },
    }).then((regResponse) => {
      registrarId = regResponse.body.id;

      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Fac Test Scheme ${RUN_ID}`,
          primaryKey: `fac-pk-${RUN_ID}`,
          validationPattern: '^\\d{11}$',
          linkTemplate: '/{primaryKey}/{value}',
        },
      }).then((schemeResponse) => {
        schemeId = schemeResponse.body.id;

        // Create primary identifier
        cy.request({
          method: 'POST',
          url: '/api/v1/identifiers',
          body: {
            schemeId,
            value: '11111111111',
          },
        }).then((identResponse) => {
          identifierId = identResponse.body.id;
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
          secondaryIdentifierId = secIdentResponse.body.id;
        });
      });
    });

    // Create prerequisite organisation
    cy.request({
      method: 'POST',
      url: '/api/v1/organisations',
      body: [{ name: `Fac Test Organisation ${RUN_ID}` }],
    }).then((orgResponse) => {
      organisationId = orgResponse.body[0].id;
    });
  });

  after(() => {
    const preserveTenant = config.tenantMode === 'closed';
    cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/facilities — creates facilities', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/facilities',
        body: [
          {
            name: `E2E Facility ${RUN_ID}`,
            operatingOrganisationId: organisationId,
          },
        ],
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body).to.be.an('array');
        expect(response.body).to.have.length(1);
        expect(response.body[0].name).to.eq(`E2E Facility ${RUN_ID}`);
        expect(response.body[0].operatingOrganisationId).to.eq(organisationId);

        createdFacilityId = response.body[0].id;
      });
    });

    it('GET /api/v1/facilities — lists facilities', () => {
      cy.request('/api/v1/facilities').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.pagination).to.exist;

        const created = response.body.data.find(
          (f: any) => f.id === createdFacilityId,
        );
        expect(created).to.exist;
      });
    });

    it('GET /api/v1/facilities — filters by search', () => {
      cy.request(`/api/v1/facilities?search=E2E Facility ${RUN_ID}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.greaterThan(0);

        response.body.data.forEach((f: any) => {
          expect(f.name).to.include('E2E Facility');
        });
      });
    });

    it('GET /api/v1/facilities — filters by organisationId', () => {
      cy.request(`/api/v1/facilities?organisationId=${organisationId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.greaterThan(0);

        response.body.data.forEach((f: any) => {
          expect(f.operatingOrganisationId).to.eq(organisationId);
        });
      });
    });

    it('GET /api/v1/facilities/:id — retrieves specific facility', () => {
      cy.request(`/api/v1/facilities/${createdFacilityId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(createdFacilityId);
        expect(response.body.name).to.eq(`E2E Facility ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/facilities/:id — updates name', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/facilities/${createdFacilityId}`,
        body: { name: `Updated Facility ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`Updated Facility ${RUN_ID}`);
      });
    });

    it('GET /api/v1/facilities/:id — confirms update persisted', () => {
      cy.request(`/api/v1/facilities/${createdFacilityId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`Updated Facility ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/facilities/:id — assigns primary identifier', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/facilities/${createdFacilityId}`,
        body: { primaryIdentifierId: identifierId },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.primaryIdentifierId).to.eq(identifierId);
      });
    });

    it('PATCH /api/v1/facilities/:id — assigns secondary identifiers', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/facilities/${createdFacilityId}`,
        body: { secondaryIdentifierIds: [secondaryIdentifierId] },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.secondaryIdentifiers).to.be.an('array');
        expect(response.body.secondaryIdentifiers).to.have.length(1);
      });
    });

    it('GET /api/v1/facilities/:id — confirms identifiers assigned', () => {
      cy.request(`/api/v1/facilities/${createdFacilityId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.primaryIdentifierId).to.eq(identifierId);
        expect(response.body.secondaryIdentifiers).to.be.an('array');
        expect(response.body.secondaryIdentifiers).to.have.length(1);
      });
    });

    it('PATCH /api/v1/facilities/:id — clears secondary identifiers', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/facilities/${createdFacilityId}`,
        body: { secondaryIdentifierIds: [] },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.secondaryIdentifiers).to.be.an('array');
        expect(response.body.secondaryIdentifiers).to.have.length(0);
      });
    });

    it('DELETE /api/v1/facilities/:id — deletes the facility', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/facilities/${createdFacilityId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
      });
    });

    it('GET /api/v1/facilities/:id — returns 404 after deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/facilities/${createdFacilityId}`,
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
        url: '/api/v1/facilities',
        body: [{}],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when body is not an array', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/facilities',
        body: { name: `Not Array ${RUN_ID}` },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when body is an empty array', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/facilities',
        body: [],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 404 for nonexistent facility', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/facilities/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/facilities?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/facilities?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });

  describe('Pagination', () => {
    it('supports limit and offset parameters', () => {
      cy.request('/api/v1/facilities?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data.length).to.be.at.most(1);
      });
    });
  });
});
