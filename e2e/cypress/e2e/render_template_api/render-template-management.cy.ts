describe('Render Template API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let dataModelId: string;
  let createdTemplateId: string;
  let rt2024TemplateId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // Find a data model to associate templates with
    cy.request('/api/v1/data-models').then((response) => {
      const dm = response.body.data.find((d: any) => !d.isExtension);
      if (dm) {
        dataModelId = dm.id;
      }
    });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: 'e2e-test-org' });
  });

  describe('CRUD operations', () => {
    it('POST — creates a WebRenderingTemplate2022 render template', function () {
      if (!dataModelId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: `E2E Template ${RUN_ID}`,
          dataModelId,
          renderMethodType: 'WebRenderingTemplate2022',
          template: `<html><body><h1>E2E Test Template ${RUN_ID}</h1></body></html>`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.id).to.be.a('string');
        expect(response.body.name).to.eq(`E2E Template ${RUN_ID}`);
        expect(response.body.dataModelId).to.eq(dataModelId);
        expect(response.body.renderMethodType).to.eq('WebRenderingTemplate2022');
        expect(response.body.storageUrl).to.be.a('string').and.not.be.empty;
        expect(response.body.hash).to.be.a('string').and.not.be.empty;
        expect(response.body.storageExternalId).to.be.a('string');
        expect(response.body.storageServiceInstanceId).to.be.a('string');

        // WebRenderingTemplate2022 does not use RT2024 fields
        expect(response.body.inline).to.be.null;
        expect(response.body.mediaType).to.be.null;
        expect(response.body.mediaQuery).to.be.null;

        createdTemplateId = response.body.id;
      });
    });

    it('POST — creates a RenderTemplate2024 with optional fields', function () {
      if (!dataModelId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: `E2E RT2024 Template ${RUN_ID}`,
          dataModelId,
          renderMethodType: 'RenderTemplate2024',
          template: `<html><body><h1>RT2024 Template ${RUN_ID}</h1></body></html>`,
          inline: true,
          mediaType: 'text/html',
          mediaQuery: 'print',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.name).to.eq(`E2E RT2024 Template ${RUN_ID}`);
        expect(response.body.renderMethodType).to.eq('RenderTemplate2024');
        expect(response.body.inline).to.be.true;
        expect(response.body.mediaType).to.eq('text/html');
        expect(response.body.mediaQuery).to.eq('print');

        rt2024TemplateId = response.body.id;
      });
    });

    it('POST — creates with isPrimary', function () {
      if (!dataModelId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: `E2E Primary Template ${RUN_ID}`,
          dataModelId,
          renderMethodType: 'WebRenderingTemplate2022',
          template: `<html><body><h1>Primary Template ${RUN_ID}</h1></body></html>`,
          isPrimary: true,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.isPrimary).to.be.true;

        // Clean up — only keep the other templates for remaining tests
        cy.request({ method: 'DELETE', url: `/api/v1/render-templates/${response.body.id}` });
      });
    });

    it('GET /api/v1/render-templates — lists with pagination metadata', function () {
      if (!createdTemplateId) this.skip();

      cy.request('/api/v1/render-templates').then((response) => {
        expect(response.status).to.eq(200);
        // Paginated response shape
        expect(response.body.data).to.be.an('array');
        expect(response.body.pagination).to.exist;
        expect(response.body.pagination.total).to.be.a('number');
        expect(response.body.pagination.limit).to.be.a('number');
        expect(response.body.pagination.offset).to.eq(0);
        expect(response.body.pagination).to.have.property('hasMore');

        const found = response.body.data.find(
          (t: any) => t.id === createdTemplateId,
        );
        expect(found).to.exist;
      });
    });

    it('GET /api/v1/render-templates — filters by dataModelId', function () {
      if (!dataModelId) this.skip();

      cy.request(`/api/v1/render-templates?dataModelId=${dataModelId}`).then((response) => {
        expect(response.status).to.eq(200);
        response.body.data.forEach((t: any) => {
          expect(t.dataModelId).to.eq(dataModelId);
        });
      });
    });

    it('GET /api/v1/render-templates/:id — retrieves a specific render template', function () {
      if (!createdTemplateId) this.skip();

      cy.request(`/api/v1/render-templates/${createdTemplateId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(createdTemplateId);
        expect(response.body.name).to.eq(`E2E Template ${RUN_ID}`);
      });
    });

    it('PATCH — updates name', function () {
      if (!createdTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${createdTemplateId}`,
        body: { name: `Updated E2E Template ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`Updated E2E Template ${RUN_ID}`);
      });
    });

    it('PATCH — re-uploads when template content is provided', function () {
      if (!createdTemplateId) this.skip();

      // Capture old hash before update
      cy.request(`/api/v1/render-templates/${createdTemplateId}`).then((before) => {
        const oldHash = before.body.hash;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/render-templates/${createdTemplateId}`,
          body: { template: `<html><body><h1>Updated content ${RUN_ID}</h1></body></html>` },
        }).then((response) => {
          expect(response.status).to.eq(200);
          // Server re-uploads so storageUrl and hash are present
          expect(response.body.storageUrl).to.be.a('string').and.not.be.empty;
          expect(response.body.hash).to.be.a('string').and.not.be.empty;
          // Hash must differ because content changed
          expect(response.body.hash).to.not.eq(oldHash);
        });
      });
    });

    it('PATCH — updates isPrimary', function () {
      if (!createdTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${createdTemplateId}`,
        body: { isPrimary: true },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.isPrimary).to.be.true;
      });
    });

    it('PATCH — updates RenderTemplate2024 fields', function () {
      if (!rt2024TemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${rt2024TemplateId}`,
        body: { inline: false, mediaQuery: 'screen' },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.inline).to.be.false;
        expect(response.body.mediaQuery).to.eq('screen');
      });
    });

    it('GET — confirms PATCH updates persisted', function () {
      if (!createdTemplateId) this.skip();

      cy.request(`/api/v1/render-templates/${createdTemplateId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`Updated E2E Template ${RUN_ID}`);
        expect(response.body.isPrimary).to.be.true;
      });
    });

    it('DELETE — deletes a render template with 204', function () {
      if (!createdTemplateId) this.skip();

      cy.request({
        method: 'DELETE',
        url: `/api/v1/render-templates/${createdTemplateId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
        expect(response.body).to.be.empty;
      });
    });

    it('GET — returns 404 after deletion', function () {
      if (!createdTemplateId) this.skip();

      cy.request({
        method: 'GET',
        url: `/api/v1/render-templates/${createdTemplateId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('DELETE — cleans up RT2024 template', function () {
      if (!rt2024TemplateId) this.skip();

      cy.request({
        method: 'DELETE',
        url: `/api/v1/render-templates/${rt2024TemplateId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
      });
    });
  });

  describe('Pagination', () => {
    it('supports limit and offset parameters', () => {
      cy.request('/api/v1/render-templates?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.at.most(1);
        expect(response.body.pagination.limit).to.eq(1);
        expect(response.body.pagination.offset).to.eq(0);
      });
    });

    it('returns correct pagination metadata', () => {
      cy.request('/api/v1/render-templates').then((allResponse) => {
        const total = allResponse.body.pagination.total;

        cy.request('/api/v1/render-templates?limit=1&offset=0').then((response) => {
          expect(response.body.pagination.total).to.eq(total);
          expect(response.body.pagination.hasMore).to.eq(total > 1);
        });
      });
    });
  });

  describe('Validation errors — POST', () => {
    it('returns 400 when name is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          dataModelId: 'dm-1',
          renderMethodType: 'WebRenderingTemplate2022',
          template: '<html>test</html>',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 when dataModelId is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          renderMethodType: 'WebRenderingTemplate2022',
          template: '<html>test</html>',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 when renderMethodType is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'dm-1',
          template: '<html>test</html>',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 when template is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'dm-1',
          renderMethodType: 'WebRenderingTemplate2022',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 for invalid renderMethodType', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'dm-1',
          renderMethodType: 'InvalidType',
          template: '<html>test</html>',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 when storageUrl is provided (server-managed)', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'dm-1',
          renderMethodType: 'WebRenderingTemplate2022',
          template: '<html>test</html>',
          storageUrl: 'https://evil.com/inject',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('storageUrl');
      });
    });

    it('returns 400 when hash is provided (server-managed)', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'dm-1',
          renderMethodType: 'WebRenderingTemplate2022',
          template: '<html>test</html>',
          hash: 'injected-hash',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('hash');
      });
    });

    it('returns 400 when isPrimary is not a boolean', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'dm-1',
          renderMethodType: 'WebRenderingTemplate2022',
          template: '<html>test</html>',
          isPrimary: 'yes',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('isPrimary');
      });
    });

    it('returns 400 when inline is not a boolean', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'dm-1',
          renderMethodType: 'RenderTemplate2024',
          template: '<html>test</html>',
          inline: 'yes',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('inline');
      });
    });

    it('returns 404 when dataModelId does not exist', function () {
      if (!dataModelId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'nonexistent-dm-id',
          renderMethodType: 'WebRenderingTemplate2022',
          template: '<html>test</html>',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 when WebRenderingTemplate2022 includes RT2024 fields', function () {
      if (!dataModelId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId,
          renderMethodType: 'WebRenderingTemplate2022',
          template: '<html>test</html>',
          inline: true,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('not applicable');
      });
    });
  });

  describe('Validation errors — PATCH', () => {
    let tempTemplateId: string;

    before(function () {
      if (!dataModelId) this.skip();

      // Create a temporary template for PATCH validation tests
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: `E2E PATCH Validation Template ${RUN_ID}`,
          dataModelId,
          renderMethodType: 'WebRenderingTemplate2022',
          template: `<html><body>PATCH validation test ${RUN_ID}</body></html>`,
        },
      }).then((response) => {
        tempTemplateId = response.body.id;
      });
    });

    after(() => {
      if (tempTemplateId) {
        cy.request({
          method: 'DELETE',
          url: `/api/v1/render-templates/${tempTemplateId}`,
          failOnStatusCode: false,
        });
      }
    });

    it('returns 400 when body is empty', function () {
      if (!tempTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${tempTemplateId}`,
        body: {},
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('updatable field');
      });
    });

    it('returns 400 when storageUrl is provided (server-managed)', function () {
      if (!tempTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${tempTemplateId}`,
        body: { storageUrl: 'https://evil.com' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('storageUrl');
      });
    });

    it('returns 400 when hash is provided (server-managed)', function () {
      if (!tempTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${tempTemplateId}`,
        body: { hash: 'injected-hash' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('hash');
      });
    });

    it('returns 400 when renderMethodType is provided (immutable)', function () {
      if (!tempTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${tempTemplateId}`,
        body: { renderMethodType: 'RenderTemplate2024' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('renderMethodType');
      });
    });

    it('returns 400 when name is empty string', function () {
      if (!tempTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${tempTemplateId}`,
        body: { name: '' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 when isPrimary is not a boolean', function () {
      if (!tempTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${tempTemplateId}`,
        body: { isPrimary: 'yes' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('isPrimary');
      });
    });

    it('returns 400 when inline is not a boolean', function () {
      if (!tempTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${tempTemplateId}`,
        body: { inline: 'yes' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('inline');
      });
    });

    it('returns 404 for nonexistent render template', () => {
      cy.request({
        method: 'PATCH',
        url: '/api/v1/render-templates/nonexistent-id',
        body: { name: 'Should not work' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });
  });

  describe('Validation errors — GET and DELETE', () => {
    it('returns 404 for nonexistent render template on GET', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/render-templates/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 404 for nonexistent render template on DELETE', () => {
      cy.request({
        method: 'DELETE',
        url: '/api/v1/render-templates/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/render-templates?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/render-templates?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });
  });
});
