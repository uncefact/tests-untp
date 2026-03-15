import { config } from '../../../support/config';

describe('Data Model API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let parentConfigId: string;
  let createdDataModelId: string;
  let testTenantId: string;

  before(() => {
    // Clean up any stale data from a previous failed run
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });
    cy.task('cleanupTestUsers', { emails: [config.user.email, config.user2.email] });

    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: config.user.email }).then((result: any) => {
      testTenantId = result.tenantId;
    });

    // Find a core data model to use as parent for extension tests
    cy.request('/api/v1/data-models').then((response) => {
      const core = response.body.data.find((dm: any) => !dm.isExtension);
      if (core) {
        parentConfigId = core.id;
      }
    });
  });

  after(() => {
    const preserveTenant = config.tenantMode === 'closed';
    cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
  });

  describe('Listing core data models', () => {
    it('GET /api/v1/data-models — lists data models including system defaults', () => {
      cy.request('/api/v1/data-models').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body).to.not.have.property('ok');
        expect(response.body.pagination).to.exist;
        expect(response.body.pagination.total).to.be.a('number');
      });
    });

    it('GET /api/v1/data-models — filters by credentialType', () => {
      cy.request('/api/v1/data-models?credentialType=DigitalProductPassport').then((response) => {
        expect(response.status).to.eq(200);
        response.body.data.forEach((dm: any) => {
          expect(dm.credentialType).to.eq('DigitalProductPassport');
        });
      });
    });

    it('GET /api/v1/data-models — list items do not include extensions, renderTemplates, or parentConfig', () => {
      cy.request('/api/v1/data-models').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array').that.is.not.empty;
        response.body.data.forEach((dm: any) => {
          expect(dm).to.not.have.property('extensions');
          expect(dm).to.not.have.property('renderTemplates');
          expect(dm).to.not.have.property('parentConfig');
        });
      });
    });

    it('GET /api/v1/data-models/:id — detail response includes parentConfig, extensions, and renderTemplates', function () {
      if (!parentConfigId) this.skip();

      cy.request(`/api/v1/data-models/${parentConfigId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.have.property('parentConfig');
        expect(response.body).to.have.property('extensions').that.is.an('array');
        expect(response.body).to.have.property('renderTemplates').that.is.an('array');
      });
    });

    it('GET /api/v1/data-models — filters by version', () => {
      cy.request('/api/v1/data-models?version=0.6.0').then((response) => {
        expect(response.status).to.eq(200);
        response.body.data.forEach((dm: any) => {
          expect(dm.version).to.eq('0.6.0');
        });
      });
    });

    it('GET /api/v1/data-models — filters by isExtension=false', () => {
      cy.request('/api/v1/data-models?isExtension=false').then((response) => {
        expect(response.status).to.eq(200);
        response.body.data.forEach((dm: any) => {
          expect(dm.isExtension).to.be.false;
        });
      });
    });
  });

  describe('CRUD operations on extensions', () => {
    it('POST /api/v1/data-models — creates a data model extension', function () {
      if (!parentConfigId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: `E2E DPP Extension ${RUN_ID}`,
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: `https://example.com/e2e-${RUN_ID}/schema.json`,
          contextUrl: `https://example.com/e2e-${RUN_ID}/context.jsonld`,
          parentConfigId,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.name).to.eq(`E2E DPP Extension ${RUN_ID}`);
        expect(response.body.credentialType).to.eq('DigitalProductPassport');
        expect(response.body.version).to.eq('0.6.1');
        expect(response.body.isExtension).to.be.true;

        createdDataModelId = response.body.id;
      });
    });

    it('POST /api/v1/data-models — includes optional websiteUrl', function () {
      if (!parentConfigId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: `E2E DCC Extension ${RUN_ID}`,
          credentialType: 'DigitalConformityCredential',
          version: '0.6.1',
          schemaUrl: `https://example.com/e2e-dcc-${RUN_ID}/schema.json`,
          contextUrl: `https://example.com/e2e-dcc-${RUN_ID}/context.jsonld`,
          parentConfigId,
          websiteUrl: `https://example.com/e2e-dcc-${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.websiteUrl).to.eq(`https://example.com/e2e-dcc-${RUN_ID}`);

        // Clean up — only keep the first extension for remaining tests
        cy.request({ method: 'DELETE', url: `/api/v1/data-models/${response.body.id}` });
      });
    });

    it('GET /api/v1/data-models — includes newly created extension', function () {
      if (!createdDataModelId) this.skip();

      cy.request('/api/v1/data-models').then((response) => {
        expect(response.status).to.eq(200);
        const found = response.body.data.find((dm: any) => dm.id === createdDataModelId);
        expect(found).to.exist;
      });
    });

    it('GET /api/v1/data-models — filters by isExtension=true', () => {
      cy.request('/api/v1/data-models?isExtension=true').then((response) => {
        expect(response.status).to.eq(200);
        response.body.data.forEach((dm: any) => {
          expect(dm.isExtension).to.be.true;
        });
      });
    });

    it('GET /api/v1/data-models/:id — retrieves a specific data model', function () {
      if (!createdDataModelId) this.skip();

      cy.request(`/api/v1/data-models/${createdDataModelId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(createdDataModelId);
        expect(response.body.name).to.eq(`E2E DPP Extension ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/data-models/:id — updates name', function () {
      if (!createdDataModelId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/data-models/${createdDataModelId}`,
        body: { name: `Updated E2E Extension ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`Updated E2E Extension ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/data-models/:id — updates schemaUrl and contextUrl', function () {
      if (!createdDataModelId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/data-models/${createdDataModelId}`,
        body: {
          schemaUrl: `https://example.com/e2e-updated-${RUN_ID}/schema.json`,
          contextUrl: `https://example.com/e2e-updated-${RUN_ID}/context.jsonld`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.schemaUrl).to.eq(`https://example.com/e2e-updated-${RUN_ID}/schema.json`);
        expect(response.body.contextUrl).to.eq(`https://example.com/e2e-updated-${RUN_ID}/context.jsonld`);
      });
    });

    it('GET /api/v1/data-models/:id — confirms updates persisted', function () {
      if (!createdDataModelId) this.skip();

      cy.request(`/api/v1/data-models/${createdDataModelId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`Updated E2E Extension ${RUN_ID}`);
        expect(response.body.schemaUrl).to.eq(`https://example.com/e2e-updated-${RUN_ID}/schema.json`);
      });
    });

    it('GET /api/v1/data-models/:id/form-config — returns form configuration', function () {
      if (!createdDataModelId) this.skip();

      cy.request(`/api/v1/data-models/${createdDataModelId}/form-config`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.formConfig).to.exist;
        expect(response.body.formConfig.dataModelId).to.eq(createdDataModelId);
        expect(response.body.formConfig.credentialType).to.eq('DigitalProductPassport');
        expect(response.body.formConfig.sections).to.be.an('array');
        expect(response.body.formConfig.sections.length).to.be.greaterThan(0);
      });
    });

    it('POST /api/v1/data-models — accepts a custom credentialType for extensions', function () {
      if (!parentConfigId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: `E2E Custom Type Extension ${RUN_ID}`,
          credentialType: 'DigitalLivestockPassport',
          version: '0.4.0',
          schemaUrl: `https://example.com/e2e-custom-${RUN_ID}/schema.json`,
          contextUrl: `https://example.com/e2e-custom-${RUN_ID}/context.jsonld`,
          parentConfigId,
          websiteUrl: `https://example.com/e2e-custom-${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialType).to.eq('DigitalLivestockPassport');
        expect(response.body.isExtension).to.be.true;
        expect(response.body.parentConfigId).to.eq(parentConfigId);

        // Clean up
        cy.request({ method: 'DELETE', url: `/api/v1/data-models/${response.body.id}` });
      });
    });

    it('DELETE /api/v1/data-models/:id — deletes the data model extension', function () {
      if (!createdDataModelId) this.skip();

      cy.request({
        method: 'DELETE',
        url: `/api/v1/data-models/${createdDataModelId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
      });
    });

    it('GET /api/v1/data-models/:id — returns 404 after deletion', function () {
      if (!createdDataModelId) this.skip();

      cy.request({
        method: 'GET',
        url: `/api/v1/data-models/${createdDataModelId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  describe('Pagination', () => {
    it('supports limit and offset parameters', () => {
      cy.request('/api/v1/data-models?limit=1&offset=0').then((response) => {
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
    it('returns 400 when name is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          parentConfigId: 'some-id',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when credentialType is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: 'Test',
          version: '0.6.1',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          parentConfigId: 'some-id',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when version is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: 'Test',
          credentialType: 'DigitalProductPassport',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          parentConfigId: 'some-id',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when schemaUrl is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: 'Test',
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          contextUrl: 'https://example.com/context.jsonld',
          parentConfigId: 'some-id',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when contextUrl is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: 'Test',
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'https://example.com/schema.json',
          parentConfigId: 'some-id',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when parentConfigId is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: 'Test',
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('POST /api/v1/data-models — created data model is always an extension regardless of isExtension in body', function () {
      if (!parentConfigId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: `E2E Force Core Attempt ${RUN_ID}`,
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: `https://example.com/e2e-force-core-${RUN_ID}/schema.json`,
          contextUrl: `https://example.com/e2e-force-core-${RUN_ID}/context.jsonld`,
          parentConfigId,
          isExtension: false,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.isExtension).to.be.true;

        // Clean up
        cy.request({ method: 'DELETE', url: `/api/v1/data-models/${response.body.id}` });
      });
    });

    it('returns 400 for invalid isExtension filter', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/data-models?isExtension=maybe',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/data-models?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/data-models?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when PATCH body is empty', function () {
      if (!parentConfigId) this.skip();

      // Create a temporary extension to test PATCH validation
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: `Temp Extension ${RUN_ID}`,
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'https://example.com/temp/schema.json',
          contextUrl: 'https://example.com/temp/context.jsonld',
          parentConfigId,
        },
      }).then((createResponse) => {
        const tempId = createResponse.body.id;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/data-models/${tempId}`,
          body: {},
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
        });

        // Clean up
        cy.request({ method: 'DELETE', url: `/api/v1/data-models/${tempId}` });
      });
    });

    it('returns 404 for nonexistent data model', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/data-models/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 404 for form-config on nonexistent data model', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/data-models/nonexistent-id/form-config',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('POST /api/v1/data-models — returns 400 when schemaUrl points to a private address', function () {
      if (!parentConfigId || Cypress.env('VERIFY_ALLOW_PRIVATE_URLS')) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: 'Private URL Test',
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'http://127.0.0.1/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          parentConfigId,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('private or reserved');
      });
    });

    it('POST /api/v1/data-models — returns 400 when contextUrl points to a private address', function () {
      if (!parentConfigId || Cypress.env('VERIFY_ALLOW_PRIVATE_URLS')) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: 'Private URL Test',
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'http://169.254.169.254/context.jsonld',
          parentConfigId,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('private or reserved');
      });
    });

    it('PATCH /api/v1/data-models/:id — returns 400 when schemaUrl points to a private address', function () {
      if (!parentConfigId || Cypress.env('VERIFY_ALLOW_PRIVATE_URLS')) this.skip();

      // Create a temporary extension to test PATCH validation
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: `Temp SSRF Test ${RUN_ID}`,
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          parentConfigId,
        },
      }).then((createResponse) => {
        const tempId = createResponse.body.id;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/data-models/${tempId}`,
          body: { schemaUrl: 'http://10.0.0.1/schema.json' },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
          expect(response.body.error).to.include('private or reserved');
        });

        // Clean up
        cy.request({ method: 'DELETE', url: `/api/v1/data-models/${tempId}` });
      });
    });

    it('PATCH /api/v1/data-models/:id — returns 400 when contextUrl points to a private address', function () {
      if (!parentConfigId || Cypress.env('VERIFY_ALLOW_PRIVATE_URLS')) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: `Temp SSRF Context Test ${RUN_ID}`,
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          parentConfigId,
        },
      }).then((createResponse) => {
        const tempId = createResponse.body.id;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/data-models/${tempId}`,
          body: { contextUrl: 'http://192.168.1.1/context.jsonld' },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
          expect(response.body.error).to.include('private or reserved');
        });

        // Clean up
        cy.request({ method: 'DELETE', url: `/api/v1/data-models/${tempId}` });
      });
    });

    it('POST /api/v1/data-models — returns 400 for invalid JSON body', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: 'not valid json',
        headers: { 'Content-Type': 'application/json' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('POST /api/v1/data-models — returns 404 for nonexistent parentConfigId', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/data-models',
        body: {
          name: 'Test Extension',
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          parentConfigId: 'nonexistent-parent-id',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('PATCH /api/v1/data-models/:id — returns 404 for nonexistent data model', () => {
      cy.request({
        method: 'PATCH',
        url: '/api/v1/data-models/nonexistent-id',
        body: { name: 'Test' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('DELETE /api/v1/data-models/:id — returns 404 for nonexistent data model', () => {
      cy.request({
        method: 'DELETE',
        url: '/api/v1/data-models/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });
});
