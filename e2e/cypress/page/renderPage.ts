class RenderPage {
  verifyPageTitleAndContent(expectedType: string, expectedIssuerId: string) {
    cy.contains('Type').should('be.visible');
    cy.contains(expectedType).should('be.visible');

    cy.contains('Issued by').should('be.visible');
    cy.contains(expectedIssuerId).should('be.visible');

    cy.contains('Issue date').should('be.visible');
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
}

export default RenderPage;
