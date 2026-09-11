import './commands/api-auth';
import './commands/common';
import { config } from './config';

before(() => {
  // The session actor's cookies are captured for Node-side cleanup, then the
  // browser's copy is cleared so a spec that authenticates with a bearer
  // token is not silently answered as the session user (the cookie would
  // otherwise ride on every cy.request and collapse the service-account
  // tenants into one). The residue check runs before any spec creates data.
  // Cookies are cleared for every domain, not only the RI's: the identity
  // provider's own session cookie would otherwise sign the second user in as
  // the first when the two live on different hosts.
  cy.task('prepareE2ERun').then(() =>
    cy
      .apiLogin(config.user2.email, config.user2.password || config.user.password)
      .then(() => cy.clearAllCookies())
      .then(() => cy.apiLogin())
      .then(() => cy.task('checkE2EResidue'))
      .then(() => cy.clearAllCookies()),
  );
});

after(() => {
  cy.task('cleanupE2ERunData');
});
