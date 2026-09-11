import './commands/api-auth';
import './commands/common';

before(() => {
  cy.task('prepareE2ERun').then(() => {
    if (Cypress.env('E2E_DB_ACCESS') !== true) return cy.task('checkE2EResidue');
    // The residue check needs the session actor, whose cookies are captured
    // for Node-side cleanup. The browser's copy is cleared afterwards so a
    // spec that authenticates with a bearer token is not silently answered
    // as the session user (the cookie would otherwise ride on every
    // cy.request and collapse the service-account tenants into one).
    return cy
      .apiLogin()
      .then(() => cy.task('checkE2EResidue'))
      .then(() => cy.clearCookies());
  });
});

after(() => {
  cy.task('cleanupE2ERunData');
});
