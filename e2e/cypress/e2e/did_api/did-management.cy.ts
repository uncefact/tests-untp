import { config } from '../../support/config';

describe('DID API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let testTenantId: string;
  let createdDidId: string;
  let createdDid: string;
  let defaultDidId: string;
  let vcServiceInstanceId: string;

  before(() => {
    // Clean up any stale data from a previous failed run
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });

    // Login first — NextAuth creates the User record on first login
    cy.apiLogin();

    // Seed test organisation and link the logged-in user
    cy.task('seedTestOrg', { userEmail: config.user.email }).then((result: any) => {
      testTenantId = result.tenantId;
    });

    // Create VC service instance (needed for DID import)
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'E2E VCKit VC',
        config: {
          baseUrl: config.services.vckit.baseUrl,
          apiKey: config.services.vckit.apiKey,
        },
        isPrimary: true,
      },
    }).then((res) => {
      expect(res.status).to.eq(201);
      vcServiceInstanceId = res.body.id;
    });
  });

  after(() => {
    const preserveTenant = config.tenantMode === 'closed';
    cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/dids — creates a managed DID', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: {
          type: 'MANAGED',
          method: 'DID_WEB',
          alias: `e2e-test-${RUN_ID}`,
          name: `E2E Test DID ${RUN_ID}`,
          description: 'Created by Cypress E2E test',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body).to.not.have.property('ok');
        expect(response.body.did).to.match(/^did:web:.+:.+/);
        expect(response.body.type).to.eq('MANAGED');
        expect(response.body.status).to.eq('ACTIVE');
        expect(response.body.id).to.be.a('string');
        expect(response.body.name).to.eq(`E2E Test DID ${RUN_ID}`);
        expect(response.body.description).to.eq('Created by Cypress E2E test');
        expect(response.body.method).to.eq('DID_WEB');
        expect(response.body.serviceInstanceId).to.be.a('string');

        createdDidId = response.body.id;
        createdDid = response.body.did;
      });
    });

    it('GET /api/v1/dids — lists DIDs with pagination metadata', () => {
      cy.request('/api/v1/dids').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.not.have.property('ok');

        // Paginated response shape
        expect(response.body.data).to.be.an('array');
        expect(response.body.pagination).to.exist;
        expect(response.body.pagination.total).to.be.a('number');
        expect(response.body.pagination.limit).to.be.a('number');
        expect(response.body.pagination.offset).to.eq(0);
        expect(response.body.pagination).to.have.property('hasMore');

        // Should contain at least the created DID and the system default
        expect(response.body.data.length).to.be.at.least(2);

        const defaultDid = response.body.data.find(
          (d: any) => d.isDefault === true,
        );
        expect(defaultDid).to.exist;

        defaultDidId = defaultDid.id;
        expect(defaultDid.keyId).to.be.a('string').and.not.be.empty;
      });
    });

    it('GET /api/v1/dids/:id — retrieves a specific DID', () => {
      cy.request(`/api/v1/dids/${createdDidId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.not.have.property('ok');
        expect(response.body.id).to.eq(createdDidId);
        expect(response.body.name).to.eq(`E2E Test DID ${RUN_ID}`);
        expect(response.body.did).to.eq(createdDid);
        expect(response.body.type).to.eq('MANAGED');
      });
    });

    it('PATCH /api/v1/dids/:id — updates DID name', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/dids/${createdDidId}`,
        body: { name: `Updated E2E DID ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.not.have.property('ok');
        expect(response.body.name).to.eq(`Updated E2E DID ${RUN_ID}`);
        expect(response.body.id).to.eq(createdDidId);
      });
    });

    it('PATCH /api/v1/dids/:id — updates DID description', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/dids/${createdDidId}`,
        body: { description: `Updated description ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.description).to.eq(`Updated description ${RUN_ID}`);
      });
    });

    it('PATCH /api/v1/dids/:id — sets isDefault on a managed DID', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/dids/${createdDidId}`,
        body: { isDefault: true },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.isDefault).to.eq(true);
      });
    });

    it('GET /api/v1/dids/:id — confirms isDefault persisted', () => {
      cy.request(`/api/v1/dids/${createdDidId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.isDefault).to.eq(true);
      });
    });

    it('GET /api/v1/dids/:id — confirms updates persisted', () => {
      cy.request(`/api/v1/dids/${createdDidId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`Updated E2E DID ${RUN_ID}`);
        expect(response.body.description).to.eq(`Updated description ${RUN_ID}`);
      });
    });

    it('GET /api/v1/dids/:id/document — retrieves DID document', () => {
      // Use the system default DID — it points to a real domain that VCKit
      // can resolve.  Locally-created did:web DIDs have fake aliases and
      // cannot be resolved over HTTPS.
      cy.request(`/api/v1/dids/${defaultDidId}/document`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.not.have.property('ok');
        expect(response.body.id).to.match(/^did:web:/);
        expect(response.body).to.have.property('verificationMethod');
      });
    });

    it('POST /api/v1/dids/:id/verify — verifies DID', () => {
      cy.request({
        method: 'POST',
        url: `/api/v1/dids/${createdDidId}/verify`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.not.have.property('ok');
        expect(response.body.verification).to.exist;
        expect(response.body.verification.checks).to.be.an('array');
        expect(response.body.did).to.exist;
        expect(response.body.did.id).to.eq(createdDidId);
      });
    });

    it('POST /api/v1/dids/:id/verify — returns 400 for system default DID', () => {
      cy.request({
        method: 'POST',
        url: `/api/v1/dids/${defaultDidId}/verify`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('System default DIDs cannot be verified');
      });
    });

    it('PATCH /api/v1/dids/:id — unsets isDefault before deletion', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/dids/${createdDidId}`,
        body: { isDefault: false },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.isDefault).to.eq(false);
      });
    });

    it('DELETE /api/v1/dids/:id — deletes a managed DID', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/dids/${createdDidId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
        expect(response.body).to.be.empty;
      });
    });

    it('GET /api/v1/dids/:id — returns 404 after deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/dids/${createdDidId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  describe('Filtering and pagination', () => {
    it('filters DIDs by type', () => {
      cy.request('/api/v1/dids?type=MANAGED').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        response.body.data.forEach((did: any) => {
          expect(did.type).to.eq('MANAGED');
        });
      });
    });

    it('filters DIDs by status', () => {
      cy.request('/api/v1/dids?status=ACTIVE').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        response.body.data.forEach((did: any) => {
          expect(did.status).to.eq('ACTIVE');
        });
      });
    });

    it('supports limit and offset', () => {
      cy.request('/api/v1/dids?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data.length).to.be.at.most(1);
        expect(response.body.pagination.limit).to.eq(1);
        expect(response.body.pagination.offset).to.eq(0);
      });
    });

    it('returns correct pagination metadata', () => {
      // First get total count
      cy.request('/api/v1/dids').then((allResponse) => {
        const total = allResponse.body.pagination.total;

        // Request with limit smaller than total
        cy.request(`/api/v1/dids?limit=1&offset=0`).then((response) => {
          expect(response.body.pagination.total).to.eq(total);
          expect(response.body.pagination.hasMore).to.eq(total > 1);
        });
      });
    });

    it('returns 400 for invalid type filter', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/dids?type=INVALID',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 for invalid limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/dids?limit=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });

  describe('Self-managed DID flow', () => {
    let selfManagedDidId: string;

    it('creates a self-managed DID with UNVERIFIED status', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: {
          type: 'SELF_MANAGED',
          method: 'DID_WEB',
          alias: `e2e-self-managed-${RUN_ID}`,
          name: `E2E Self-Managed DID ${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.type).to.eq('SELF_MANAGED');
        expect(response.body.status).to.eq('UNVERIFIED');

        selfManagedDidId = response.body.id;
      });
    });

    it('verification updates status based on result', () => {
      cy.request({
        method: 'POST',
        url: `/api/v1/dids/${selfManagedDidId}/verify`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.verification).to.exist;
        expect(response.body.did.status).to.be.oneOf([
          'VERIFIED',
          'UNVERIFIED',
          'VERIFICATION_FAILED',
        ]);
      });
    });

    it('DELETE — deletes a self-managed DID', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/dids/${selfManagedDidId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
      });
    });

    it('GET — returns 404 after self-managed DID deletion', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/dids/${selfManagedDidId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });

  describe('DID import flow', () => {
    let importedDidId: string;
    const importedDidString = `did:web:imported-${RUN_ID}.example.com`;

    it('POST /api/v1/dids/import — imports an external DID with UNVERIFIED status', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids/import',
        body: {
          did: importedDidString,
          method: 'DID_WEB',
          keyId: `imported-key-${RUN_ID}`,
          serviceInstanceId: vcServiceInstanceId,
          name: `E2E Imported DID ${RUN_ID}`,
          description: 'Imported by Cypress E2E test',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body).to.not.have.property('ok');
        expect(response.body.type).to.eq('SELF_MANAGED');
        expect(response.body.status).to.eq('UNVERIFIED');
        expect(response.body.did).to.eq(importedDidString);
        expect(response.body.name).to.eq(`E2E Imported DID ${RUN_ID}`);

        importedDidId = response.body.id;
      });
    });

    it('GET /api/v1/dids/:id — retrieves the imported DID', () => {
      cy.request(`/api/v1/dids/${importedDidId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.name).to.eq(`E2E Imported DID ${RUN_ID}`);
        expect(response.body.type).to.eq('SELF_MANAGED');
        expect(response.body.status).to.eq('UNVERIFIED');
      });
    });

    it('POST /api/v1/dids/:id/verify — verification updates imported DID status', () => {
      cy.request({
        method: 'POST',
        url: `/api/v1/dids/${importedDidId}/verify`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.verification).to.exist;
        expect(response.body.did.status).to.be.oneOf([
          'VERIFIED',
          'UNVERIFIED',
          'VERIFICATION_FAILED',
        ]);
      });
    });

    it('POST /api/v1/dids/import — returns 400 for missing required fields', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids/import',
        body: {},
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('POST /api/v1/dids/import — returns 400 for missing method', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids/import',
        body: {
          did: `did:web:missing-method-${RUN_ID}.example.com`,
          keyId: 'some-key',
          serviceInstanceId: vcServiceInstanceId,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('POST /api/v1/dids/import — returns 400 for missing keyId', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids/import',
        body: {
          did: `did:web:missing-key-${RUN_ID}.example.com`,
          method: 'DID_WEB',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('POST /api/v1/dids/import — returns error for duplicate DID', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids/import',
        body: {
          did: importedDidString,
          method: 'DID_WEB',
          keyId: `imported-key-duplicate-${RUN_ID}`,
          serviceInstanceId: vcServiceInstanceId,
          name: `E2E Duplicate Imported DID ${RUN_ID}`,
          description: 'Duplicate import by Cypress E2E test',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.not.eq(201);
      });
    });
  });

  describe('Duplicate DID handling', () => {
    let duplicateTestDidId: string;
    const duplicateAlias = `e2e-dup-${RUN_ID}`;

    it('POST — creates a DID for the duplicate test', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: {
          type: 'MANAGED',
          method: 'DID_WEB',
          alias: duplicateAlias,
          name: `E2E Duplicate Test DID ${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        duplicateTestDidId = response.body.id;
      });
    });

    it('POST — returns 409 when creating a DID with the same alias', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: {
          type: 'MANAGED',
          method: 'DID_WEB',
          alias: duplicateAlias,
          name: `E2E Duplicate DID ${RUN_ID}`,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(409);
        expect(response.body.error).to.be.a('string');
        expect(response.body.error).to.include('already exists');
      });
    });

    it('DELETE — cleans up the duplicate test DID', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/dids/${duplicateTestDidId}`,
      }).then((response) => {
        expect(response.status).to.eq(204);
      });
    });
  });

  describe('Error handling', () => {
    it('GET — returns 404 for non-existent DID', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/dids/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('PATCH — returns 404 for non-existent DID', () => {
      cy.request({
        method: 'PATCH',
        url: '/api/v1/dids/nonexistent-id',
        body: { name: 'Should not work' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('DELETE — returns 404 for non-existent DID', () => {
      cy.request({
        method: 'DELETE',
        url: '/api/v1/dids/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('DELETE — returns 400 when deleting the default DID', () => {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/dids/${defaultDidId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('default');
      });
    });

    it('PATCH — returns 404 when attempting to set isDefault on system default DID', () => {
      cy.request({
        method: 'PATCH',
        url: `/api/v1/dids/${defaultDidId}`,
        body: { isDefault: true },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('POST — returns 400 for invalid type', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: { type: 'INVALID', method: 'DID_WEB', alias: 'test' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('POST — returns 400 for missing method', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: { type: 'MANAGED', alias: 'test' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('POST — returns 400 for missing alias', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: { type: 'MANAGED', method: 'DID_WEB' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('POST — returns 400 for invalid method', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: { type: 'MANAGED', method: 'INVALID', alias: 'test' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('PATCH — returns 400 for empty body', () => {
      // Need a valid DID to test — use the default
      cy.request({
        method: 'PATCH',
        url: `/api/v1/dids/${defaultDidId}`,
        body: {},
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('GET /document — returns 404 for non-existent DID', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/dids/nonexistent-id/document',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('POST /verify — returns 404 for non-existent DID', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids/nonexistent-id/verify',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.error).to.be.a('string');
      });
    });
  });
});
