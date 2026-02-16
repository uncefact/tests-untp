describe('Product API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let registrarId: string;
  let schemeId: string;
  let identifierId: string;
  let secondaryIdentifierId: string;
  let organisationId: string;
  let facilityId: string;
  let modelProductId: string;
  let batchProductId: string;
  let itemProductId: string;
  let standaloneItemId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // Create prerequisite registrar -> scheme -> 2 identifiers chain
    cy.request({
      method: 'POST',
      url: '/api/v1/registrars',
      body: {
        name: `Prod Test Registrar ${RUN_ID}`,
        namespace: `prod-reg-${RUN_ID}`,
        url: `https://prod-reg-${RUN_ID}.example.com`,
      },
    }).then((regResponse) => {
      registrarId = regResponse.body.registrar.id;

      cy.request({
        method: 'POST',
        url: '/api/v1/schemes',
        body: {
          registrarId,
          name: `Prod Test Scheme ${RUN_ID}`,
          primaryKey: `prod-key-${RUN_ID}`,
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
      body: [{ name: `Prod Test Org ${RUN_ID}` }],
    }).then((orgResponse) => {
      organisationId = orgResponse.body.organisations[0].id;
    });

    // Create prerequisite facility
    cy.request({
      method: 'POST',
      url: '/api/v1/facilities',
      body: [{ name: `Prod Test Facility ${RUN_ID}` }],
    }).then((facResponse) => {
      facilityId = facResponse.body.facilities[0].id;
    });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: 'e2e-test-org' });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/products — creates a MODEL product', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [
          {
            name: `Model Product ${RUN_ID}`,
            level: 'MODEL',
            producedByOrganisationId: organisationId,
            manufacturingFacilityId: facilityId,
          },
        ],
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.products).to.be.an('array');
        expect(response.body.products).to.have.length(1);
        expect(response.body.products[0].name).to.eq(
          `Model Product ${RUN_ID}`,
        );
        expect(response.body.products[0].level).to.eq('MODEL');
        expect(response.body.products[0].parentId).to.be.null;

        modelProductId = response.body.products[0].id;
      });
    });

    it('POST /api/v1/products — creates a BATCH product with MODEL parent', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [
          {
            name: `Batch Product ${RUN_ID}`,
            level: 'BATCH',
            parentId: modelProductId,
          },
        ],
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.products).to.be.an('array');
        expect(response.body.products).to.have.length(1);
        expect(response.body.products[0].name).to.eq(
          `Batch Product ${RUN_ID}`,
        );
        expect(response.body.products[0].level).to.eq('BATCH');
        expect(response.body.products[0].parentId).to.eq(modelProductId);

        batchProductId = response.body.products[0].id;
      });
    });

    it('POST /api/v1/products — creates an ITEM product with BATCH parent', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [
          {
            name: `Item Product ${RUN_ID}`,
            level: 'ITEM',
            parentId: batchProductId,
          },
        ],
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.products).to.be.an('array');
        expect(response.body.products).to.have.length(1);
        expect(response.body.products[0].name).to.eq(
          `Item Product ${RUN_ID}`,
        );
        expect(response.body.products[0].level).to.eq('ITEM');
        expect(response.body.products[0].parentId).to.eq(batchProductId);

        itemProductId = response.body.products[0].id;
      });
    });

    it('POST /api/v1/products — creates an ITEM product with no parent', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [
          {
            name: `Standalone Item ${RUN_ID}`,
            level: 'ITEM',
          },
        ],
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.products).to.be.an('array');
        expect(response.body.products).to.have.length(1);
        expect(response.body.products[0].name).to.eq(
          `Standalone Item ${RUN_ID}`,
        );
        expect(response.body.products[0].level).to.eq('ITEM');
        expect(response.body.products[0].parentId).to.be.null;

        standaloneItemId = response.body.products[0].id;
      });
    });

    it('GET /api/v1/products — lists products', () => {
      cy.request('/api/v1/products').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.products).to.be.an('array');

        const created = response.body.products.find(
          (p: any) => p.id === modelProductId,
        );
        expect(created).to.exist;
      });
    });

    it('GET /api/v1/products — filters by level', () => {
      cy.request('/api/v1/products?level=MODEL').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.products).to.be.an('array');
        expect(response.body.products.length).to.be.greaterThan(0);

        response.body.products.forEach((p: any) => {
          expect(p.level).to.eq('MODEL');
        });
      });
    });

    it('GET /api/v1/products — filters by parentId', () => {
      cy.request(`/api/v1/products?parentId=${modelProductId}`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.products).to.be.an('array');
          expect(response.body.products.length).to.be.greaterThan(0);

          response.body.products.forEach((p: any) => {
            expect(p.parentId).to.eq(modelProductId);
          });

          const batch = response.body.products.find(
            (p: any) => p.id === batchProductId,
          );
          expect(batch).to.exist;
        },
      );
    });

    it('GET /api/v1/products — filters by organisationId', () => {
      cy.request(`/api/v1/products?organisationId=${organisationId}`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.products).to.be.an('array');

          response.body.products.forEach((p: any) => {
            expect(p.producedByOrganisationId).to.eq(organisationId);
          });
        },
      );
    });

    it('GET /api/v1/products — filters by facilityId', () => {
      cy.request(`/api/v1/products?facilityId=${facilityId}`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.products).to.be.an('array');

          response.body.products.forEach((p: any) => {
            expect(p.manufacturingFacilityId).to.eq(facilityId);
          });
        },
      );
    });

    it('GET /api/v1/products/:id — retrieves specific product', () => {
      cy.request(`/api/v1/products/${modelProductId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.product).to.exist;
        expect(response.body.product.id).to.eq(modelProductId);
        expect(response.body.product.name).to.eq(`Model Product ${RUN_ID}`);
        expect(response.body.product.level).to.eq('MODEL');
      });
    });

    it('PATCH /api/v1/products/:id — updates name', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/products/${modelProductId}`,
        body: { name: `Updated Model ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.product.name).to.eq(`Updated Model ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/products/:id — level is stripped (immutable)', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/products/${modelProductId}`,
        body: { name: `Still Model ${RUN_ID}`, level: 'BATCH' },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.product.name).to.eq(`Still Model ${RUN_ID}`);
        expect(response.body.product.level).to.eq('MODEL');
      });
    });

    it('GET /api/v1/products/:id — confirms update persisted', () => {
      cy.request(`/api/v1/products/${modelProductId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.product.name).to.eq(`Still Model ${RUN_ID}`);
        expect(response.body.product.level).to.eq('MODEL');
      });
    });

    it('PATCH /api/v1/products/:id — assigns identifiers', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/products/${modelProductId}`,
        body: {
          primaryIdentifierId: identifierId,
          secondaryIdentifierIds: [secondaryIdentifierId],
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.product).to.exist;
      });
    });

    it('GET /api/v1/products/:id — confirms identifiers assigned', () => {
      cy.request(`/api/v1/products/${modelProductId}`).then((response) => {
        expect(response.status).to.eq(200);

        const product = response.body.product;
        expect(product.primaryIdentifier).to.exist;
        expect(product.primaryIdentifier.id).to.eq(identifierId);
        expect(product.secondaryIdentifiers).to.be.an('array');
        expect(product.secondaryIdentifiers).to.have.length(1);
        expect(product.secondaryIdentifiers[0].identifier.id).to.eq(
          secondaryIdentifierId,
        );
      });
    });
  });

  describe('Hierarchy validation', () => {
    it('returns 400 for MODEL with parent', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [
          {
            name: `Invalid Model ${RUN_ID}`,
            level: 'MODEL',
            parentId: modelProductId,
          },
        ],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for BATCH without parent', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [
          {
            name: `Invalid Batch ${RUN_ID}`,
            level: 'BATCH',
          },
        ],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for ITEM with MODEL parent', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [
          {
            name: `Invalid Item ${RUN_ID}`,
            level: 'ITEM',
            parentId: modelProductId,
          },
        ],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });

  describe('Delete behaviour', () => {
    it('returns 400 when deleting MODEL with BATCH children', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/products/${modelProductId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('deletes BATCH — detaches ITEM children', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/products/${batchProductId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.deep.eq({});
      });
    });

    it('confirms ITEM is now parentless after BATCH deletion', () => {
      cy.request(`/api/v1/products/${itemProductId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.product.id).to.eq(itemProductId);
        expect(response.body.product.parentId).to.be.null;
      });
    });

    it('deletes remaining products', () => {
      // Delete standalone item
      cy.request({
        method: 'DELETE',
        url: `/api/v1/products/${standaloneItemId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.deep.eq({});
      });

      // Delete the detached item
      cy.request({
        method: 'DELETE',
        url: `/api/v1/products/${itemProductId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.deep.eq({});
      });

      // Delete model (now has no BATCH children)
      cy.request({
        method: 'DELETE',
        url: `/api/v1/products/${modelProductId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.deep.eq({});
      });
    });

    it('GET /api/v1/products/:id — returns 404 after deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/products/${modelProductId}`,
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
        url: '/api/v1/products',
        body: [{ level: 'MODEL' }],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when level is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [{ name: `No Level Product ${RUN_ID}` }],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when level is invalid', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [{ name: `Invalid Level Product ${RUN_ID}`, level: 'INVALID' }],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when body is not an array', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: { name: `Not Array Product ${RUN_ID}`, level: 'MODEL' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when body is an empty array', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/products',
        body: [],
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 404 for nonexistent product', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/products/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/products?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/products?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });

  describe('Pagination', () => {
    it('supports limit and offset parameters', () => {
      cy.request('/api/v1/products?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.products.length).to.be.at.most(1);
      });
    });
  });
});
