import RenderPage from 'cypress/page/renderPage';

const renderPage = new RenderPage();

describe('Verify page credential rendering', () => {
  function verifyErrorDisplayed(errorText: string) {
    cy.contains(errorText, { timeout: 10000 }).should('be.visible');
    cy.get('button').contains('JSON').should('not.exist');
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
    it('should display error when hash does not match', () => {
      cy.intercept('POST', '/api/v1/credentials/verify', {
        statusCode: 422,
        body: {
          error: 'Credential hash does not match the expected hash',
          code: 'HASH_MISMATCH',
        },
      }).as('verifyCredential');

      cy.visit('/verify?uri=https://example.com/test-credential');
      cy.wait('@verifyCredential');
      verifyErrorDisplayed('HASH_MISMATCH');
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
});
