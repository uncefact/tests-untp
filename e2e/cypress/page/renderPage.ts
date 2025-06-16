import moment from 'moment';

class RenderPage {
  constructor() {}

  verifyPageTitleAndContent() {
    const credential = Cypress.env('lastCredential');

    cy.contains('Type').should('be.visible');
    cy.contains(credential.type[0]).should('be.visible');

    cy.contains('Issued by').should('be.visible');
    cy.contains(credential.issuer.id).should('be.visible');

    cy.contains('Issue date').should('be.visible');
    cy.contains(moment(credential.issuanceDate).format('MM/DD/YYYY')).should('be.visible');
  }

  verifyButtonsVisibilityAndText() {
    cy.contains('button', 'Rendered').should('be.visible').and('have.text', 'Rendered');
    cy.contains('button', 'JSON').should('be.visible').and('have.text', 'JSON');
    cy.contains('button', 'Download').should('be.visible').and('have.text', 'Download');
  }

  verifyDownloadVC() {
    cy.verifyFileDownload('Download', 'cypress/downloads/vc.json');
  }

  verifyTemplateRenderingWhenContentExists() {
    cy.contains('button', 'Rendered').click();

    cy.get('div[role="tabpanel"]#tabpanel-0')
    .should('be.visible');
    
    cy.get('[data-testid="loading-indicator"]')
    .should('not.exist');

    cy.get('[data-testid="rendered-template"]')
    .should('be.visible');
  }

  verifyNoContentRenderingWhenTemplateIsEmpty() {
    cy.get('div[role="tabpanel"]#tabpanel-0').invoke('html', '');
    cy.get('div[role="tabpanel"]#tabpanel-0').should('not.be.visible');
  }

  verifyJSONContentDisplay() {
    cy.contains('button', 'JSON').click();
    cy.get('div[role="tabpanel"]#tabpanel-1').should('be.visible').and('contain.html', 'pre');
    cy.get('pre').should('contain.text', '"@context"');
  }
}

export default RenderPage;
