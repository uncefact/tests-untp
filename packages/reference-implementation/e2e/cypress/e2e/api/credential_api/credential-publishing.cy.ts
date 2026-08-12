import { config } from '../../../support/config';

/**
 * Publishes a credential with access roles and asserts the resulting link
 * set directly on the Identity Resolver: the machine verification link, the
 * credential link, and the human verification link, with the roles attached
 * to the latter two only.
 */
describe('Credential publishing to the Identity Resolver', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  const NAMESPACE = `e2e-pub-${RUN_ID}`;
  const PRIMARY_KEY = `arn-${RUN_ID}`;
  const IDENTIFIER_VALUE = '90664869327';
  const MACHINE_VERIFICATION_URL = 'https://verify.example.com/api/verify';
  const ACCESS_ROLES = ['untp:accessRole#Regulator', 'untp:accessRole#Auditor'];

  const idrAuthHeaders = { Authorization: `Bearer ${config.services.idr.apiKey}` };

  let testTenantId: string;
  let defaultDidValue: string;

  before(() => {
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });
    cy.task('cleanupTestUsers', { emails: [config.user.email, config.user2.email] });

    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: config.user.email }).then((result: any) => {
      testTenantId = result.tenantId;
    });

    // VC and storage service instances, required for signing and storing
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'E2E VCKit VC (publishing)',
        config: {
          baseUrl: config.services.vckit.baseUrl,
          apiKey: config.services.vckit.apiKey,
        },
        apiVersion: '1.0.0',
        isPrimary: true,
      },
    }).then((res) => expect(res.status).to.eq(201));

    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'STORAGE',
        adapterType: 'UNCEFACT_STORAGE',
        name: 'E2E Storage (publishing)',
        config: {
          baseUrl: config.services.storage.baseUrl,
          apiKey: config.services.storage.apiKey,
          apiVersion: config.services.storage.apiVersion,
          publicBucket: config.services.storage.publicBucket,
          privateBucket: config.services.storage.privateBucket,
        },
        apiVersion: '3.1.0',
        isPrimary: true,
      },
    }).then((res) => expect(res.status).to.eq(201));

    cy.request('/api/v1/dids').then((response) => {
      expect(response.status).to.eq(200);
      const defaultDid = response.body.data.find((d: any) => d.isDefault === true);
      expect(defaultDid).to.exist;
      defaultDidValue = defaultDid.did;
    });

    // Identifier chain the publish path resolves: registrar (namespace) ->
    // scheme (primary key) -> identifier -> product carrying it as primary
    cy.request({
      method: 'POST',
      url: '/api/v1/registrars',
      body: {
        name: `E2E Publishing Registrar ${RUN_ID}`,
        namespace: NAMESPACE,
        url: `https://registrar-${RUN_ID}.example.com`,
      },
    })
      .then((res) => {
        expect(res.status).to.eq(201);
        return cy.request({
          method: 'POST',
          url: '/api/v1/schemes',
          body: {
            registrarId: res.body.id,
            name: `E2E ARN Scheme ${RUN_ID}`,
            primaryKey: PRIMARY_KEY,
            validationPattern: '^\\d{11}$',
            linkTemplate: '/{primaryKey}/{value}',
          },
        });
      })
      .then((res) => {
        expect(res.status).to.eq(201);
        return cy.request({
          method: 'POST',
          url: '/api/v1/identifiers',
          body: { schemeId: res.body.id, value: IDENTIFIER_VALUE },
        });
      })
      .then((res) => {
        expect(res.status).to.eq(201);
        const identifierId = res.body.id;
        return cy
          .request({
            method: 'POST',
            url: '/api/v1/products',
            body: [{ name: `E2E Published Product ${RUN_ID}`, level: 'MODEL' }],
          })
          .then((productRes) => {
            expect(productRes.status).to.eq(201);
            return cy.request({
              method: 'PATCH',
              url: `/api/v1/products/${productRes.body[0].id}`,
              body: { primaryIdentifierId: identifierId },
            });
          });
      })
      .then((res) => expect(res.status).to.eq(200));

    // The resolver only accepts registrations for namespaces it knows, and
    // registering a scheme with the RI does not register it upstream, so the
    // namespace is registered directly, as an operator would.
    cy.request({
      method: 'POST',
      url: `${config.services.idr.publicBaseUrl}/api/v4/identifiers`,
      headers: idrAuthHeaders,
      body: {
        namespace: NAMESPACE,
        applicationIdentifiers: [
          {
            title: `E2E ARN ${RUN_ID}`,
            label: 'ARN',
            shortcode: PRIMARY_KEY,
            ai: PRIMARY_KEY,
            type: 'I',
            regex: '^\\d{11}$',
          },
        ],
      },
    }).then((res) => expect(res.status).to.be.oneOf([200, 201]));
  });

  after(() => {
    const preserveTenant = config.tenantMode === 'closed';
    cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
  });

  it('publishes a credential with access roles and registers all three links on the IDR', () => {
    cy.request({
      method: 'POST',
      url: '/api/v1/credentials',
      body: {
        credentialPayload: {
          '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/'],
          id: `urn:uuid:e2e-pub-${RUN_ID}`,
          type: ['DigitalProductPassport', 'VerifiableCredential'],
          issuer: {
            type: ['CredentialIssuer'],
            id: defaultDidValue,
            name: `E2E Publishing Issuer ${RUN_ID}`,
          },
          credentialSubject: {
            type: ['ProductPassport'],
            id: `https://example.com/products/e2e-pub-${RUN_ID}`,
            product: {
              type: ['Product'],
              id: `https://example.com/products/e2e-pub-${RUN_ID}`,
              registeredId: IDENTIFIER_VALUE,
              name: `E2E Published Product ${RUN_ID}`,
            },
          },
        },
        credentialType: 'DigitalProductPassport',
        version: '0.6.1',
        publishingOptions: {
          publish: true,
          machineVerificationUrl: MACHINE_VERIFICATION_URL,
          accessRole: ACCESS_ROLES,
        },
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body.credentialId).to.be.a('string');
      expect(response.body.warnings, JSON.stringify(response.body.warnings)).to.be.undefined;
    });

    cy.request({
      method: 'GET',
      url: `${config.services.idr.publicBaseUrl}/api/v4/resolver/links`,
      headers: idrAuthHeaders,
      qs: {
        namespace: NAMESPACE,
        identificationKeyType: PRIMARY_KEY,
        identificationKey: IDENTIFIER_VALUE,
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      const links = response.body;
      expect(links, JSON.stringify(links)).to.have.length(3);

      const machineLink = links.find((l: any) => l.targetUrl === MACHINE_VERIFICATION_URL);
      expect(machineLink, 'machine verification link').to.exist;
      expect(machineLink.linkType).to.eq('gs1:verificationService');
      expect(machineLink.mimeType).to.eq('text/plain');
      expect(machineLink.accessRole ?? []).to.have.length(0);

      const credentialLink = links.find((l: any) => l.mimeType === 'application/json');
      expect(credentialLink, 'credential link').to.exist;
      expect(credentialLink.linkType).to.eq('untp:dpp');
      expect(credentialLink.targetUrl).to.be.a('string').and.not.eq(MACHINE_VERIFICATION_URL);
      expect(credentialLink.accessRole).to.have.members(ACCESS_ROLES);

      const humanLink = links.find((l: any) => l.mimeType === 'text/html');
      expect(humanLink, 'human verification link').to.exist;
      expect(humanLink.linkType).to.eq('untp:dpp');
      expect(humanLink.targetUrl).to.include('/verify');
      expect(humanLink.accessRole).to.have.members(ACCESS_ROLES);
    });
  });
});
