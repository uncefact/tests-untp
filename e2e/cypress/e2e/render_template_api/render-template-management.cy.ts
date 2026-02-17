describe('Render Template API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let dataModelId: string;
  let createdTemplateId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // Find a data model to associate templates with
    cy.request('/api/v1/data-models').then((response) => {
      const dm = response.body.dataModels.find(
        (d: any) => !d.isExtension,
      );
      if (dm) {
        dataModelId = dm.id;
      }
    });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: 'e2e-test-org' });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/render-templates — creates a render template', function () {
      if (!dataModelId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: `E2E Template ${RUN_ID}`,
          dataModelId,
          storageUrl: `https://storage.example.com/e2e-${RUN_ID}/template.hbs`,
          hash: `sha256-e2e-${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.ok).to.be.true;
        expect(response.body.renderTemplate).to.exist;
        expect(response.body.renderTemplate.name).to.eq(`E2E Template ${RUN_ID}`);
        expect(response.body.renderTemplate.dataModelId).to.eq(dataModelId);
        expect(response.body.renderTemplate.storageUrl).to.eq(`https://storage.example.com/e2e-${RUN_ID}/template.hbs`);
        expect(response.body.renderTemplate.hash).to.eq(`sha256-e2e-${RUN_ID}`);

        createdTemplateId = response.body.renderTemplate.id;
      });
    });

    it('POST /api/v1/render-templates — creates with isPrimary', function () {
      if (!dataModelId) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: `E2E Primary Template ${RUN_ID}`,
          dataModelId,
          storageUrl: `https://storage.example.com/e2e-primary-${RUN_ID}/template.hbs`,
          hash: `sha256-primary-${RUN_ID}`,
          isPrimary: true,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.renderTemplate.isPrimary).to.be.true;

        // Clean up — only keep the first template for remaining tests
        cy.request({ method: 'DELETE', url: `/api/v1/render-templates/${response.body.renderTemplate.id}` });
      });
    });

    it('GET /api/v1/render-templates — lists render templates', function () {
      if (!createdTemplateId) this.skip();

      cy.request('/api/v1/render-templates').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.renderTemplates).to.be.an('array');

        const found = response.body.renderTemplates.find(
          (t: any) => t.id === createdTemplateId,
        );
        expect(found).to.exist;
      });
    });

    it('GET /api/v1/render-templates — filters by dataModelId', function () {
      if (!dataModelId) this.skip();

      cy.request(`/api/v1/render-templates?dataModelId=${dataModelId}`).then((response) => {
        expect(response.status).to.eq(200);
        response.body.renderTemplates.forEach((t: any) => {
          expect(t.dataModelId).to.eq(dataModelId);
        });
      });
    });

    it('GET /api/v1/render-templates/:id — retrieves a specific render template', function () {
      if (!createdTemplateId) this.skip();

      cy.request(`/api/v1/render-templates/${createdTemplateId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.renderTemplate.id).to.eq(createdTemplateId);
        expect(response.body.renderTemplate.name).to.eq(`E2E Template ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/render-templates/:id — updates name', function () {
      if (!createdTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${createdTemplateId}`,
        body: { name: `Updated E2E Template ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.renderTemplate.name).to.eq(`Updated E2E Template ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/render-templates/:id — updates storageUrl and hash', function () {
      if (!createdTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${createdTemplateId}`,
        body: {
          storageUrl: `https://storage.example.com/e2e-updated-${RUN_ID}/template.hbs`,
          hash: `sha256-updated-${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.renderTemplate.storageUrl).to.eq(`https://storage.example.com/e2e-updated-${RUN_ID}/template.hbs`);
        expect(response.body.renderTemplate.hash).to.eq(`sha256-updated-${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/render-templates/:id — updates isPrimary', function () {
      if (!createdTemplateId) this.skip();

      cy.request({
        method: 'PATCH',
        url: `/api/v1/render-templates/${createdTemplateId}`,
        body: { isPrimary: true },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.renderTemplate.isPrimary).to.be.true;
      });
    });

    it('GET /api/v1/render-templates/:id — confirms updates persisted', function () {
      if (!createdTemplateId) this.skip();

      cy.request(`/api/v1/render-templates/${createdTemplateId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.renderTemplate.name).to.eq(`Updated E2E Template ${RUN_ID}`);
        expect(response.body.renderTemplate.storageUrl).to.eq(`https://storage.example.com/e2e-updated-${RUN_ID}/template.hbs`);
        expect(response.body.renderTemplate.hash).to.eq(`sha256-updated-${RUN_ID}`);
        expect(response.body.renderTemplate.isPrimary).to.be.true;
      });
    });

    it('DELETE /api/v1/render-templates/:id — deletes the render template', function () {
      if (!createdTemplateId) this.skip();

      cy.request({
        method: 'DELETE',
        url: `/api/v1/render-templates/${createdTemplateId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
      });
    });

    it('GET /api/v1/render-templates/:id — returns 404 after deletion', function () {
      if (!createdTemplateId) this.skip();

      cy.request({
        method: 'GET',
        url: `/api/v1/render-templates/${createdTemplateId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  describe('Pagination', () => {
    it('supports limit and offset parameters', () => {
      cy.request('/api/v1/render-templates?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.renderTemplates.length).to.be.at.most(1);
      });
    });
  });

  describe('Validation errors', () => {
    it('returns 400 when name is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          dataModelId: 'dm-1',
          storageUrl: 'https://example.com/template.hbs',
          hash: 'abc123',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when dataModelId is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          storageUrl: 'https://example.com/template.hbs',
          hash: 'abc123',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when storageUrl is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'dm-1',
          hash: 'abc123',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when hash is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: 'Test',
          dataModelId: 'dm-1',
          storageUrl: 'https://example.com/template.hbs',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/render-templates?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/render-templates?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when PATCH body is empty', function () {
      if (!dataModelId) this.skip();

      // Create a temporary template
      cy.request({
        method: 'POST',
        url: '/api/v1/render-templates',
        body: {
          name: `Temp Template ${RUN_ID}`,
          dataModelId,
          storageUrl: 'https://example.com/temp/template.hbs',
          hash: 'temp-hash',
        },
      }).then((createResponse) => {
        const tempId = createResponse.body.renderTemplate.id;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/render-templates/${tempId}`,
          body: {},
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
        });

        // Clean up
        cy.request({ method: 'DELETE', url: `/api/v1/render-templates/${tempId}` });
      });
    });

    it('returns 404 for nonexistent render template', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/render-templates/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });
});
