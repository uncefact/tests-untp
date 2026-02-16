interface ServiceInstance {
  id: string;
  serviceType: string;
  adapterType: string;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  apiVersion: string;
  isPrimary: boolean;
}

describe('Service API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let createdServiceId: string;

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: 'e2e-test-org' });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/services — creates a service instance', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: `E2E Test VC Service ${RUN_ID}`,
          description: 'Created by Cypress E2E test',
          config: {
            endpoint: 'https://vckit-e2e.example.com',
            apiKey: 'e2e-test-key-123',
          },
          apiVersion: '1.0.0',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.serviceInstanceId).to.be.a('string');

        createdServiceId = response.body.serviceInstanceId;
      });
    });

    it('GET /api/v1/services — lists service instances including the created one', () => {
      cy.request('/api/v1/services').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.services).to.be.an('array');

        const created = response.body.services.find(
          (s: ServiceInstance) => s.id === createdServiceId,
        );
        expect(created).to.exist;
        expect(created.name).to.eq(`E2E Test VC Service ${RUN_ID}`);
      });
    });

    it('GET /api/v1/services/:id — retrieves a specific service instance', () => {
      cy.request(`/api/v1/services/${createdServiceId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.service).to.exist;
        expect(response.body.service.id).to.eq(createdServiceId);
        expect(response.body.service.serviceType).to.eq('VC');
        expect(response.body.service.adapterType).to.eq('VCKIT');
        expect(response.body.service.name).to.eq(`E2E Test VC Service ${RUN_ID}`);
        expect(response.body.service.description).to.eq('Created by Cypress E2E test');
      });
    });

    it('GET /api/v1/services/:id — masks sensitive config fields', () => {
      cy.request(`/api/v1/services/${createdServiceId}`).then((response) => {
        const config = response.body.service.config;
        expect(config).to.be.an('object');
        expect(config.endpoint).to.eq('https://vckit-e2e.example.com');
        expect(config.apiKey).to.eq('***');
      });
    });

    it('PATCH /api/v1/services/:id — updates service name', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/services/${createdServiceId}`,
        body: { name: `Updated E2E VC Service ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.service.name).to.eq(`Updated E2E VC Service ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/services/:id — updates description', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/services/${createdServiceId}`,
        body: { description: 'Updated description' },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.service.description).to.eq('Updated description');
      });
    });

    it('PATCH /api/v1/services/:id — merges config preserving existing fields', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/services/${createdServiceId}`,
        body: {
          config: {
            endpoint: 'https://vckit-e2e-updated.example.com',
          },
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        // Updated field reflected
        expect(response.body.service.config.endpoint).to.eq(
          'https://vckit-e2e-updated.example.com',
        );
        // apiKey preserved from original config (merged) and masked
        expect(response.body.service.config.apiKey).to.eq('***');
      });
    });

    it('GET /api/v1/services/:id — confirms all updates persisted', () => {
      cy.request(`/api/v1/services/${createdServiceId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.service.name).to.eq(`Updated E2E VC Service ${RUN_ID}`);
        expect(response.body.service.description).to.eq('Updated description');
        expect(response.body.service.config.endpoint).to.eq(
          'https://vckit-e2e-updated.example.com',
        );
      });
    });

    it('DELETE /api/v1/services/:id — warns without force flag', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/services/${createdServiceId}`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.deleted).to.be.false;
        expect(response.body.warning).to.exist;
      });
    });

    it('GET /api/v1/services/:id — still exists after delete without force', () => {
      cy.request(`/api/v1/services/${createdServiceId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.service.id).to.eq(createdServiceId);
      });
    });

    it('DELETE /api/v1/services/:id?force=true — deletes the service instance', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/services/${createdServiceId}?force=true`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.deleted).to.be.true;
      });
    });

    it('GET /api/v1/services/:id — returns 404 after deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/services/${createdServiceId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  describe('Primary instance toggling', () => {
    let primaryServiceId: string;
    let secondServiceId: string;

    it('creates a primary service instance', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: `E2E Primary VC ${RUN_ID}`,
          config: {
            endpoint: 'https://primary.example.com',
            apiKey: 'primary-key',
          },
          apiVersion: '1.0.0',
          isPrimary: true,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        primaryServiceId = response.body.serviceInstanceId;
      });
    });

    it('verifies the first instance is primary', () => {
      cy.request(`/api/v1/services/${primaryServiceId}`).then((response) => {
        expect(response.body.service.isPrimary).to.be.true;
      });
    });

    it('creates a second primary — first should be demoted', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: `E2E Second Primary VC ${RUN_ID}`,
          config: {
            endpoint: 'https://second.example.com',
            apiKey: 'second-key',
          },
          apiVersion: '1.0.0',
          isPrimary: true,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        secondServiceId = response.body.serviceInstanceId;
      });
    });

    it('second instance is primary, first is demoted', () => {
      cy.request('/api/v1/services').then((response) => {
        const services = response.body.services;
        const second = services.find((s: ServiceInstance) => s.id === secondServiceId);
        const first = services.find((s: ServiceInstance) => s.id === primaryServiceId);

        expect(second?.isPrimary).to.be.true;
        expect(first?.isPrimary).to.be.false;
      });
    });

    it('PATCH isPrimary toggles back to first instance', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/services/${primaryServiceId}`,
        body: { isPrimary: true },
      }).then(() => {
        cy.request('/api/v1/services').then((response) => {
          const services = response.body.services;
          const first = services.find((s: ServiceInstance) => s.id === primaryServiceId);
          const second = services.find((s: ServiceInstance) => s.id === secondServiceId);

          expect(first?.isPrimary).to.be.true;
          expect(second?.isPrimary).to.be.false;
        });
      });
    });

    after(() => {
      // Clean up both instances (ignore 404 if already deleted or never created)
      cy.request({ method: 'DELETE', url: `/api/v1/services/${primaryServiceId}?force=true`, failOnStatusCode: false });
      cy.request({ method: 'DELETE', url: `/api/v1/services/${secondServiceId}?force=true`, failOnStatusCode: false });
    });
  });

  describe('Filtering and pagination', () => {
    it('filters by serviceType', () => {
      cy.request('/api/v1/services?serviceType=DID').then((response) => {
        expect(response.status).to.eq(200);
        response.body.services.forEach((s: ServiceInstance) => {
          expect(s.serviceType).to.eq('DID');
        });
      });
    });

    it('filters by adapterType', () => {
      cy.request('/api/v1/services?adapterType=VCKIT').then((response) => {
        expect(response.status).to.eq(200);
        response.body.services.forEach((s: ServiceInstance) => {
          expect(s.adapterType).to.eq('VCKIT');
        });
      });
    });

    it('combines serviceType and adapterType filters', () => {
      cy.request('/api/v1/services?serviceType=DID&adapterType=VCKIT').then(
        (response) => {
          expect(response.status).to.eq(200);
          response.body.services.forEach((s: ServiceInstance) => {
            expect(s.serviceType).to.eq('DID');
            expect(s.adapterType).to.eq('VCKIT');
          });
        },
      );
    });

    it('supports pagination with limit', () => {
      cy.request('/api/v1/services?limit=1').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.services.length).to.be.at.most(1);
      });
    });

    it('supports pagination with limit and offset', () => {
      cy.request('/api/v1/services?limit=1&offset=0').then((firstPage) => {
        expect(firstPage.status).to.eq(200);
        expect(firstPage.body.services.length).to.be.at.most(1);

        if (firstPage.body.services.length === 1) {
          const firstId = firstPage.body.services[0].id;

          cy.request('/api/v1/services?limit=1&offset=1').then((secondPage) => {
            expect(secondPage.status).to.eq(200);
            if (secondPage.body.services.length === 1) {
              expect(secondPage.body.services[0].id).to.not.eq(firstId);
            }
          });
        }
      });
    });

    it('includes system default service instances', () => {
      cy.request('/api/v1/services').then((response) => {
        expect(response.status).to.eq(200);
        // System defaults are seeded at startup — at least one should exist
        expect(response.body.services.length).to.be.greaterThan(0);
      });
    });
  });

  describe('Validation errors', () => {
    it('returns 400 when serviceType is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          adapterType: 'VCKIT',
          name: 'Test',
          config: { endpoint: 'https://example.com', apiKey: 'key' },
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when adapterType is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          name: 'Test',
          config: { endpoint: 'https://example.com', apiKey: 'key' },
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when name is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          config: { endpoint: 'https://example.com', apiKey: 'key' },
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when config is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: 'Test',
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when apiVersion is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: 'Test',
          config: { endpoint: 'https://example.com', apiKey: 'key' },
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when serviceType is invalid', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'INVALID',
          adapterType: 'VCKIT',
          name: 'Test',
          config: { endpoint: 'https://example.com', apiKey: 'key' },
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when adapterType does not match serviceType', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'PYX_IDR',
          name: 'Test',
          config: {},
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when config is null', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: 'Test',
          config: null,
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when config is an array', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: 'Test',
          config: [],
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when config is a string', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: 'Test',
          config: 'not an object',
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when config fails schema validation', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: 'Test',
          config: { endpoint: 'not-a-url' },
          apiVersion: '1.0.0',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when PATCH body is empty', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: `Temp Service ${RUN_ID}`,
          config: {
            endpoint: 'https://temp.example.com',
            apiKey: 'temp-key',
          },
          apiVersion: '1.0.0',
        },
      }).then((createResponse) => {
        const tempId = createResponse.body.serviceInstanceId;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/services/${tempId}`,
          body: {},
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
        }).then(() => {
          // Clean up
          cy.request({
            method: 'DELETE',
            url: `/api/v1/services/${tempId}?force=true`,
          });
        });
      });
    });

    it('returns 400 when PATCH config is not an object', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: `Temp Config Type ${RUN_ID}`,
          config: {
            endpoint: 'https://temp.example.com',
            apiKey: 'temp-key',
          },
          apiVersion: '1.0.0',
        },
      }).then((createResponse) => {
        const tempId = createResponse.body.serviceInstanceId;

        cy.request({
          method: 'PATCH',
          url: `/api/v1/services/${tempId}`,
          body: { config: 'not an object' },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
        }).then(() => {
          // Clean up
          cy.request({
            method: 'DELETE',
            url: `/api/v1/services/${tempId}?force=true`,
          });
        });
      });
    });

    it('returns 404 for nonexistent service instance', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/services/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 404 when deleting nonexistent service instance', () => {
      cy.request({
        method: 'DELETE',
        url: '/api/v1/services/nonexistent-id?force=true',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 404 when patching nonexistent service instance', () => {
      cy.request({
        method: 'PATCH',
        url: '/api/v1/services/nonexistent-id',
        body: { name: 'Updated' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/services?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for negative offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/services?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for invalid serviceType filter', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/services?serviceType=INVALID',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for invalid adapterType filter', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/services?adapterType=INVALID',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });
});
