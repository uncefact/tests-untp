describe('Facility API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let registrarId: string;
  let schemeId: string;
  let identifierId: string;
  let secondaryIdentifierId: string;
  let organisationId: string;
  let createdFacilityId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

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
      registrarId = regResponse.body.registrar.id;

      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Fac Test Scheme ${RUN_ID}`,
          primaryKey: `fac-pk-${RUN_ID}`,
          validationPattern: '^\\d{11}$',
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

    // Create prerequisite organisation
    cy.request({
      method: 'POST',
      url: '/api/v1/organisations',
      body: [{ name: `Fac Test Organisation ${RUN_ID}` }],
    }).then((orgResponse) => {
      organisationId = orgResponse.body.organisations[0].id;
    });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: 'e2e-test-org' });
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
        expect(response.body.facilities).to.be.an('array');
        expect(response.body.facilities).to.have.length(1);
        expect(response.body.facilities[0].name).to.eq(`E2E Facility ${RUN_ID}`);
        expect(response.body.facilities[0].operatingOrganisationId).to.eq(organisationId);

        createdFacilityId = response.body.facilities[0].id;
      });
    });

    it('GET /api/v1/facilities — lists facilities', () => {
      cy.request('/api/v1/facilities').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facilities).to.be.an('array');

        const created = response.body.facilities.find(
          (f: any) => f.id === createdFacilityId,
        );
        expect(created).to.exist;
      });
    });

    it('GET /api/v1/facilities — filters by search', () => {
      cy.request(`/api/v1/facilities?search=E2E Facility ${RUN_ID}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facilities).to.be.an('array');
        expect(response.body.facilities.length).to.be.greaterThan(0);

        response.body.facilities.forEach((f: any) => {
          expect(f.name).to.include('E2E Facility');
        });
      });
    });

    it('GET /api/v1/facilities — filters by organisationId', () => {
      cy.request(`/api/v1/facilities?organisationId=${organisationId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facilities).to.be.an('array');
        expect(response.body.facilities.length).to.be.greaterThan(0);

        response.body.facilities.forEach((f: any) => {
          expect(f.operatingOrganisationId).to.eq(organisationId);
        });
      });
    });

    it('GET /api/v1/facilities/:id — retrieves specific facility', () => {
      cy.request(`/api/v1/facilities/${createdFacilityId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facility).to.exist;
        expect(response.body.facility.id).to.eq(createdFacilityId);
        expect(response.body.facility.name).to.eq(`E2E Facility ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/facilities/:id — updates name', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/facilities/${createdFacilityId}`,
        body: { name: `Updated Facility ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facility.name).to.eq(`Updated Facility ${RUN_ID}`);
      });
    });

    it('GET /api/v1/facilities/:id — confirms update persisted', () => {
      cy.request(`/api/v1/facilities/${createdFacilityId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facility.name).to.eq(`Updated Facility ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/facilities/:id — assigns primary identifier', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/facilities/${createdFacilityId}`,
        body: { primaryIdentifierId: identifierId },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facility.primaryIdentifierId).to.eq(identifierId);
      });
    });

    it('PATCH /api/v1/facilities/:id — assigns secondary identifiers', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/facilities/${createdFacilityId}`,
        body: { secondaryIdentifierIds: [secondaryIdentifierId] },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facility.secondaryIdentifiers).to.be.an('array');
        expect(response.body.facility.secondaryIdentifiers).to.have.length(1);
      });
    });

    it('GET /api/v1/facilities/:id — confirms identifiers assigned', () => {
      cy.request(`/api/v1/facilities/${createdFacilityId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facility.primaryIdentifierId).to.eq(identifierId);
        expect(response.body.facility.secondaryIdentifiers).to.be.an('array');
        expect(response.body.facility.secondaryIdentifiers).to.have.length(1);
      });
    });

    it('PATCH /api/v1/facilities/:id — clears secondary identifiers', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/facilities/${createdFacilityId}`,
        body: { secondaryIdentifierIds: [] },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.facility.secondaryIdentifiers).to.be.an('array');
        expect(response.body.facility.secondaryIdentifiers).to.have.length(0);
      });
    });

    it('DELETE /api/v1/facilities/:id — deletes the facility', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/facilities/${createdFacilityId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.deep.eq({});
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
        expect(response.body.facilities.length).to.be.at.most(1);
      });
    });
  });
});
