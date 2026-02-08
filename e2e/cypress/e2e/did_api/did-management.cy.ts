describe('DID API', { testIsolation: false }, () => {
  const TEST_ORG_ID = 'e2e-test-org';
  const RUN_ID = Date.now();
  let createdDidId: string;
  let defaultDidId: string;

  before(() => {
    // Login first — NextAuth creates the User record on first login
    cy.apiLogin();

    // Seed test organisation and link the logged-in user
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });
  });

  after(() => {
    cy.task('cleanupTestData', { organizationId: TEST_ORG_ID });
  });

  describe('CRUD operations', () => {
    it('POST /api/v1/dids — creates a managed DID', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: {
          type: 'MANAGED',
          name: `E2E Test DID ${RUN_ID}`,
          description: 'Created by Cypress E2E test',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.ok).to.be.true;
        expect(response.body.did.did).to.match(/^did:web:/);
        expect(response.body.did.type).to.eq('MANAGED');
        expect(response.body.did.status).to.eq('ACTIVE');

        createdDidId = response.body.did.id;
      });
    });

    it('GET /api/v1/dids — lists DIDs including system default', () => {
      cy.request('/api/v1/dids').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.dids).to.be.an('array');

        const defaultDid = response.body.dids.find(
          (d: any) => d.isDefault === true,
        );
        expect(defaultDid).to.exist;

        defaultDidId = defaultDid.id;
      });
    });

    it('GET /api/v1/dids/:id — retrieves a specific DID', () => {
      cy.request(`/api/v1/dids/${createdDidId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.did.id).to.eq(createdDidId);
        expect(response.body.did.name).to.eq(`E2E Test DID ${RUN_ID}`);
      });
    });

    it('PUT /api/v1/dids/:id — updates DID name', () => {
      cy.request({
        method: 'PUT',
        url: `/api/v1/dids/${createdDidId}`,
        body: { name: `Updated E2E DID ${RUN_ID}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.did.name).to.eq(`Updated E2E DID ${RUN_ID}`);
      });
    });

    it('GET /api/v1/dids/:id/document — retrieves DID document', () => {
      // Use the system default DID — it points to a real domain that VCKit
      // can resolve.  Locally-created did:web DIDs have fake aliases and
      // cannot be resolved over HTTPS.
      cy.request(`/api/v1/dids/${defaultDidId}/document`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.document).to.exist;
        expect(response.body.document.id).to.match(/^did:web:/);
      });
    });

    it('POST /api/v1/dids/:id/verify — verifies DID document', () => {
      cy.request({
        method: 'POST',
        url: `/api/v1/dids/${createdDidId}/verify`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.ok).to.be.true;
        expect(response.body.verification).to.exist;
        expect(response.body.verification.checks).to.be.an('array');
      });
    });
  });

  describe('Filtering and pagination', () => {
    it('filters DIDs by type', () => {
      cy.request('/api/v1/dids?type=MANAGED').then((response) => {
        expect(response.status).to.eq(200);
        response.body.dids.forEach((did: any) => {
          expect(did.type).to.eq('MANAGED');
        });
      });
    });

    it('supports pagination', () => {
      cy.request('/api/v1/dids?limit=1&offset=0').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.dids.length).to.be.at.most(1);
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
          name: `E2E Self-Managed DID ${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.did.type).to.eq('SELF_MANAGED');
        expect(response.body.did.status).to.eq('UNVERIFIED');

        selfManagedDidId = response.body.did.id;
      });
    });

    it('verification updates status based on result', () => {
      cy.request({
        method: 'POST',
        url: `/api/v1/dids/${selfManagedDidId}/verify`,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.did.status).to.be.oneOf([
          'VERIFIED',
          'UNVERIFIED',
        ]);
      });
    });
  });

  describe('Error handling', () => {
    it('returns 404 for nonexistent DID', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/dids/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });

    it('returns 400 for invalid type', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: { type: 'INVALID' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });
});
