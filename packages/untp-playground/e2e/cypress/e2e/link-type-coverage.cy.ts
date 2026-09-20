import { config } from '../support/config';
import sampleDpp from '../../../public/samples/sample-digital-product-passport-v0.7.0.json';

/**
 * Link Type Coverage (#1007): verifying a linked credential from a link set card feeds the real
 * Credentials pipeline, and the card's coverage step compares what came back with the relation
 * it was linked under. The linked document is served by intercepting the Playground's own fetch
 * proxy (this harness owns no resolver or credential host), so the journey is a browser
 * integration of the two tabs rather than a live-host test.
 */

const CARD_HEADER = '[data-testid="linkset-card-header"]';
const DCC_HREF = 'https://credentials.example.org/conformity/dcc-batch-114.json';

const linkSetWithDccLink = {
  linkset: [
    {
      anchor: 'https://resolver.example.org/01/09520123456788',
      'https://test.uncefact.org/voc/untp/dcc': [
        { href: DCC_HREF, type: 'application/vc+ld+json', title: 'Digital Conformity Credential', hreflang: ['en'] },
      ],
    },
  ],
};

const openLinkSetsTab = () => cy.contains('[role="tab"]', 'Link Sets').click();

describe('Link type coverage', () => {
  beforeEach(() => {
    cy.visit(config.playground.baseUrl);
  });

  it('stays pending with a count until a linked credential is verified, without spinning or blocking removal', () => {
    openLinkSetsTab();
    cy.uploadCredential(linkSetWithDccLink);
    cy.get(CARD_HEADER).click();
    cy.get(CARD_HEADER).find('[data-testid$="status-icon-success"]', { timeout: 20000 }).should('exist');
    cy.get('[data-testid="linkset-link-type-coverage-status-icon-pending"]').should('exist');
    cy.get('[data-testid="linkset-coverage-count"]').should('have.text', '0 of 1 credential link checked.');
    cy.get('[data-testid$="status-icon-in-progress"]').should('not.exist');
    // Removal is not blocked by pending coverage: it happens.
    cy.get('[data-testid="linkset-results"] button[aria-label^="Remove"]').click({ force: true });
    cy.get(CARD_HEADER).should('not.exist');
  });

  it('fails coverage and the card when a dcc link resolves to a Digital Product Passport', () => {
    cy.intercept('POST', '**/api/fetch', {
      statusCode: 200,
      // The fetching state is transient, and a retried query can only wait for an element about to
      // appear, never catch one that has already gone. The delay holds the row in that state long
      // enough for the geometry below to be sampled while it is on screen.
      delay: 1000,
      body: { ok: true, body: JSON.stringify(sampleDpp), contentType: 'application/json', finalUrl: DCC_HREF },
    }).as('fetchLinked');

    openLinkSetsTab();
    cy.uploadCredential(linkSetWithDccLink);
    cy.get(CARD_HEADER).click();
    cy.get('[data-testid="linked-credential-row"]')
      .first()
      .then(($row) => {
        const beforeHeight = $row[0].getBoundingClientRect().height;
        const beforeLabelWidth = $row.find('[data-testid="linked-credential-label"]')[0].getBoundingClientRect().width;
        cy.wrap($row).find('[data-testid="linked-credential-verify"]').click();
        cy.wrap($row)
          .find('[data-testid="linked-credential-fetching"]')
          .should('exist')
          .then(() => {
            cy.wrap($row).find('[data-testid="linked-credential-action-slot"]').should('contain.text', 'Fetching');
            cy.wrap($row).find('[data-testid="linked-credential-left-column"]').should('not.contain.text', 'Fetching');
            const fetchingHeight = $row[0].getBoundingClientRect().height;
            const fetchingLabelWidth = $row
              .find('[data-testid="linked-credential-label"]')[0]
              .getBoundingClientRect().width;
            cy.wrap(fetchingHeight).should('eq', beforeHeight);
            cy.wrap(fetchingLabelWidth).should('eq', beforeLabelWidth);
          });
        cy.wait('@fetchLinked');
        cy.wrap($row)
          .find('[data-testid="linked-credential-verify-again"]')
          .should('exist')
          .then(() => {
            cy.wrap($row)
              .find(
                '[data-testid="linked-credential-verified"], [data-testid="linked-credential-failed"], [data-testid="linked-credential-coverage-mismatch"]',
              )
              .should('exist');
            const settledHeight = $row[0].getBoundingClientRect().height;
            const settledLabelWidth = $row
              .find('[data-testid="linked-credential-label"]')[0]
              .getBoundingClientRect().width;
            cy.wrap(settledHeight).should('eq', beforeHeight);
            cy.wrap(settledLabelWidth).should('eq', beforeLabelWidth);
          });
      });

    // The credential runs the real pipeline on the Credentials tab; coverage compares its type
    // once it settles, whatever its own validation outcome.
    cy.get('[data-testid="linkset-link-type-coverage-status-icon-failure"]', { timeout: 60000 }).should('exist');
    cy.get('[data-testid="linkset-coverage-mismatches"]')
      .should('contain.text', 'dcc link resolved to DigitalProductPassport')
      .and('contain.text', DCC_HREF);
    cy.get('[data-testid="linked-credential-coverage-mismatch"]').click();
    cy.get('[role="tab"][data-state="active"]').should('contain.text', 'Credentials');
    cy.get('[data-testid="credential-instance-header"]').filter(':visible').should('have.attr', 'data-instance-id');
    cy.get('[data-testid="credential-instance-body"]').filter(':visible').should('be.visible');
    cy.get(CARD_HEADER).find('[data-testid$="status-icon-failure"]').should('exist');
    cy.contains('[role="tab"]', 'Link Sets').find('[data-testid="linksets-tab-failing-dot"]').should('exist');
  });
});
