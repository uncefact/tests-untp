import { config } from '../support/config';
import sampleLinkSet from '../../../public/samples/sample-link-set.json';

/**
 * Link set Schema Validation (#988): the upload entry point composes with the real schema route
 * (live or bundled fallback) and the card renders the outcome. Exact error wording, pointer
 * decoding and the version-capture rules live in the unit and component suites; this spec proves
 * the journey end to end, including that the step can go red.
 */

const CARD_HEADER = '[data-testid="linkset-card-header"]';

const openLinkSetsTab = () => cy.contains('[role="tab"]', 'Link Sets').click();

describe('Link set schema validation', () => {
  beforeEach(() => {
    cy.visit(config.playground.baseUrl);
  });

  it('validates the bundled sample against v0.7.0 and reports success', () => {
    openLinkSetsTab();
    // The selector opens and offers the published version; choosing it is the same wiring the
    // page test drives, so the real control is exercised here once.
    cy.get('#linkset-spec-version').click();
    cy.get('[role="option"]').contains('v0.7.0').click();
    cy.get('[data-testid="linkset-version-select"]').should('contain.text', 'v0.7.0');
    cy.uploadCredential(sampleLinkSet);

    cy.get(CARD_HEADER).click();
    cy.get('[data-testid="linkset-subtitle"]').should('have.text', 'Link Set · v0.7.0');
    // The browser gives the schema fetch 15s; wait past that so a slow host reads as slow, not failed.
    cy.get('[data-testid$="status-icon-success"]', { timeout: 20000 }).should('exist');
    cy.checkValidationStatus('Schema Validation', 'success');
    cy.get('[data-testid="linkset-validation-docs"]')
      .should('have.attr', 'href')
      .and('include', 'validating-link-sets');
  });

  it('fails a link set whose target has no title and names the offending path', () => {
    const malformed = JSON.parse(JSON.stringify(sampleLinkSet));
    delete malformed.linkset[0]['https://test.uncefact.org/voc/untp/dpp'][0].title;

    openLinkSetsTab();
    cy.uploadCredential(malformed);

    cy.get(CARD_HEADER).click();
    cy.get('[data-testid$="status-icon-failure"]', { timeout: 20000 }).should('exist');
    cy.checkValidationStatus('Schema Validation', 'failure');
    cy.get('[data-testid="linkset-schema-errors"]').should(
      'contain.text',
      'Missing required field: linkset → 0 → https://test.uncefact.org/voc/untp/dpp → 0 → title',
    );
  });

  it('removes a validated link set and restores it with Undo', () => {
    openLinkSetsTab();
    cy.uploadCredential(sampleLinkSet);
    cy.get(CARD_HEADER).click();
    cy.get('[data-testid$="status-icon-success"]', { timeout: 20000 }).should('exist');
    cy.checkValidationStatus('Schema Validation', 'success');

    cy.get('button[aria-label^="Remove"]').click({ force: true });
    cy.get(CARD_HEADER).should('not.exist');
    cy.contains('button', 'Undo').click();
    cy.get(CARD_HEADER).should('exist').click();
    cy.checkValidationStatus('Schema Validation', 'success');
  });
});
