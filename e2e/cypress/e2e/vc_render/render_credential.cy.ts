import RenderPage from 'cypress/page/renderPage';

const renderPage = new RenderPage();

describe('Verify page credential rendering', () => {
  beforeEach(() => {
    cy.fixture('credentials-e2e/valid-v2-enveloped-dpp.json').then((fixture) => {
      // Decode the JWT payload from the enveloped credential
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
