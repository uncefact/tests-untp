class RenderPage {
  verifyPageTitleAndContent(expectedType: string, expectedIssuerId: string) {
    cy.contains('Type').should('be.visible');
    cy.contains(expectedType).should('be.visible');

    cy.contains('Issued by').should('be.visible');
    cy.contains(expectedIssuerId).should('be.visible');

    // UNTP credentials are VCDM 2.0: the page shows Valid from, and the
    // VCDM 1.1 Issue date row (previously a fabricated "today") is gone (#855).
    cy.contains('Valid from').should('be.visible');
    cy.contains('Issue date').should('not.exist');
  }

  verifyButtonsVisibilityAndText() {
    cy.contains('button', 'Rendered').should('be.visible');
    cy.contains('button', 'JSON').should('be.visible');
    cy.contains('button', 'Download').should('be.visible');
  }

  verifyDownloadVC() {
    cy.contains('button', 'Download').click();
    cy.readFile('cypress/downloads/vc.json').should('exist');
  }

  verifyJSONContentDisplay() {
    cy.contains('button', 'JSON').click();
    cy.get('div[role="tabpanel"]#tabpanel-1').should('be.visible').and('contain.html', 'pre');
    cy.get('pre').should('contain.text', '"@context"');
  }

  verifyRenderedTemplateContent(expectedText: string) {
    cy.contains('button', 'Rendered').click();
    cy.get('[data-testid="rendered-template"]', { timeout: 10000 })
      .should('be.visible')
      .and('contain.text', expectedText);
  }

  verifyRenderedTabIsActive() {
    cy.get('div[role="tabpanel"]#tabpanel-0').should('be.visible');
  }

  verifyJSONTabIsActive() {
    cy.get('div[role="tabpanel"]#tabpanel-1').should('be.visible');
  }

  verifyRenderedTemplateError(expectedErrorText: string) {
    cy.contains('button', 'Rendered').click();
    cy.get('[data-testid="rendered-template"]', { timeout: 10000 })
      .should('be.visible')
      .and('contain.text', expectedErrorText);
  }
}

export default RenderPage;
