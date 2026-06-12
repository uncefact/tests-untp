import RenderPage from 'cypress/page/renderPage';

const renderPage = new RenderPage();

describe('Verify page credential rendering', () => {
  function verifyErrorDisplayed(errorText: string) {
    cy.contains(errorText, { timeout: 10000 }).should('be.visible');
    cy.contains('button', 'JSON').should('not.exist');
  }

  describe('successful verification', () => {
    beforeEach(() => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decoded,
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
    });

    it('should display the correct credential type and issuer', () => {
      renderPage.verifyPageTitleAndContent(
        'DigitalProductPassport',
        'did:web:uncefact.github.io:project-vckit:test-and-development',
      );
    });

    it('should display Rendered, JSON, and Download controls', () => {
      renderPage.verifyButtonsVisibilityAndText();
    });

    it('should download the credential as JSON', () => {
      renderPage.verifyDownloadVC();
    });

    it('should display JSON content when JSON tab is clicked', () => {
      renderPage.verifyJSONContentDisplay();
    });
  });

  describe('verification failures', () => {
    it('should display error when credential has been revoked (status)', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp.json').then((fixture) => {
        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: false,
            credential: fixture,
            error: { type: 'status', message: 'Credential has been revoked' },
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('Credential has been revoked');
    });

    it('should display error when credential has been tampered with (integrity)', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp.json').then((fixture) => {
        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: false,
            credential: fixture,
            error: { type: 'integrity', message: 'Credential signature is invalid' },
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('Credential signature is invalid');
    });

    it('should display error when credential has expired (temporal)', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp.json').then((fixture) => {
        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: false,
            credential: fixture,
            error: { type: 'temporal', message: 'Credential has expired' },
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('Credential has expired');
    });
  });

  describe('API errors', () => {
    it('should display error when digest does not match', () => {
      cy.intercept('POST', '/api/v1/credentials/verify', {
        statusCode: 422,
        body: {
          error: 'Credential digest does not match the expected digest',
          code: 'DIGEST_MISMATCH',
        },
      }).as('verifyCredential');

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('DIGEST_MISMATCH');
    });

    it('should display error when decryption key is missing', () => {
      cy.intercept('POST', '/api/v1/credentials/verify', {
        statusCode: 422,
        body: {
          error: 'Credential is encrypted but no decryptionKey was provided',
          code: 'DECRYPTION_REQUIRED',
        },
      }).as('verifyCredential');

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('DECRYPTION_REQUIRED');
    });

    it('should display error when decryption fails', () => {
      cy.intercept('POST', '/api/v1/credentials/verify', {
        statusCode: 422,
        body: {
          error: 'Failed to decrypt credential',
          code: 'DECRYPTION_FAILED',
        },
      }).as('verifyCredential');

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('DECRYPTION_FAILED');
    });

    it('should display error when credential type is unsupported', () => {
      cy.intercept('POST', '/api/v1/credentials/verify', {
        statusCode: 422,
        body: {
          error: 'Only EnvelopedVerifiableCredential is supported',
          code: 'UNSUPPORTED_CREDENTIAL_TYPE',
        },
      }).as('verifyCredential');

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('UNSUPPORTED_CREDENTIAL_TYPE');
    });

    it('should display error when upstream service fails', () => {
      cy.intercept('POST', '/api/v1/credentials/verify', {
        statusCode: 502,
        body: {
          error: 'Failed to fetch credential: network error',
          code: 'UPSTREAM_ERROR',
        },
      }).as('verifyCredential');

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('UPSTREAM_ERROR');
    });

    it('should display error when VC service fails', () => {
      cy.intercept('POST', '/api/v1/credentials/verify', {
        statusCode: 502,
        body: {
          error: 'Credential verification service failed',
          code: 'VC_SERVICE_ERROR',
        },
      }).as('verifyCredential');

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('VC_SERVICE_ERROR');
    });
  });

  describe('RenderTemplate2024 rendering', () => {
    it('should render inline RenderTemplate2024 template', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp-with-render.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decoded,
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      renderPage.verifyRenderedTemplateContent('Digital Product Passport');
    });

    it('should default to Rendered tab when renderMethod is present', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp-with-render.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decoded,
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      renderPage.verifyRenderedTabIsActive();
    });

    it('should default to JSON tab when no renderMethod is present', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decoded,
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      renderPage.verifyJSONTabIsActive();
    });
  });

  describe('Remote template rendering', () => {
    it('should render credential with remote URL template', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp-with-remote-render.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        // Remove digestMultibase so hash verification is skipped
        const decodedNoDigest = JSON.parse(JSON.stringify(decoded));
        decodedNoDigest.renderMethod[0] = { ...decodedNoDigest.renderMethod[0] };
        delete decodedNoDigest.renderMethod[0].digestMultibase;

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decodedNoDigest,
          },
        }).as('verifyCredential');

        cy.intercept('GET', 'https://example.com/templates/dpp.html', {
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: "<div data-testid='render-template-content'><h1>Remote DPP</h1><p>Product: {{credentialSubject.name}}</p></div>",
        }).as('fetchTemplate');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      renderPage.verifyRenderedTemplateContent('Remote DPP');
    });
  });

  describe('Template hash verification', () => {
    it('should display error when template hash does not match', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp-with-remote-render.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decoded,
          },
        }).as('verifyCredential');

        // Return template content whose hash will NOT match the fixture's fake digestMultibase
        cy.intercept('GET', 'https://example.com/templates/dpp.html', {
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: '<div><h1>Mismatched Template</h1></div>',
        }).as('fetchTemplate');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      renderPage.verifyRenderedTemplateError('Template hash does not match');
    });

    it('should render successfully when template hash verification is skipped', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp-with-remote-render.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        // Remove digestMultibase so hash verification is skipped
        const decodedNoDigest = JSON.parse(JSON.stringify(decoded));
        decodedNoDigest.renderMethod[0] = { ...decodedNoDigest.renderMethod[0] };
        delete decodedNoDigest.renderMethod[0].digestMultibase;

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decodedNoDigest,
          },
        }).as('verifyCredential');

        cy.intercept('GET', 'https://example.com/templates/dpp.html', {
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: "<div data-testid='render-template-content'><h1>Remote DPP</h1><p>Product: {{credentialSubject.name}}</p></div>",
        }).as('fetchTemplate');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      renderPage.verifyRenderedTemplateContent('Remote DPP');
    });
  });

  describe('WebRenderingTemplate2022 rendering', () => {
    it('should render credential with WebRenderingTemplate2022 inline template', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp-with-rt2022.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decoded,
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      renderPage.verifyRenderedTemplateContent('Legacy DPP');
    });

    it('should default to Rendered tab for WebRenderingTemplate2022', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp-with-rt2022.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decoded,
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      renderPage.verifyRenderedTabIsActive();
    });
  });

  describe('query parameter formats', () => {
    it('should support direct query params (?uri=...&hash=...)', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        cy.intercept('POST', '/api/v1/credentials/verify', {
          statusCode: 200,
          body: {
            verified: true,
            credential: fixture,
            decodedCredential: decoded,
          },
        }).as('verifyCredential');
      });

      cy.visit('/verify?uri=https://example.com/test-credential&hash=abc123');
      cy.wait('@verifyCredential');
      renderPage.verifyPageTitleAndContent(
        'DigitalProductPassport',
        'did:web:uncefact.github.io:project-vckit:test-and-development',
      );
    });

    it('should support legacy ?q= JSON envelope', () => {
      cy.fixture('credentials-e2e/valid-v2-enveloped-dpp.json').then((fixture) => {
        const jwt = fixture.id.replace('data:application/vc+jwt,', '');
        const payload = jwt.split('.')[1];
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(padded));

        cy.intercept('POST', '/api/v1/credentials/verify', (req) => {
          expect(req.body).to.have.property('uri', 'https://example.com/test');
          expect(req.body).to.have.property('hash', 'abc123');
          req.reply({
            statusCode: 200,
            body: {
              verified: true,
              credential: fixture,
              decodedCredential: decoded,
            },
          });
        }).as('verifyCredential');
      });

      const q = encodeURIComponent(JSON.stringify({ payload: { uri: 'https://example.com/test', hash: 'abc123' } }));
      cy.visit(`/verify?q=${q}`);
      cy.wait('@verifyCredential');
      renderPage.verifyPageTitleAndContent(
        'DigitalProductPassport',
        'did:web:uncefact.github.io:project-vckit:test-and-development',
      );
    });

    it('should display error for missing uri parameter', () => {
      cy.visit('/verify', { failOnStatusCode: false });
      cy.contains('Invalid verification link', { timeout: 10000 }).should('be.visible');
    });
  });
});
