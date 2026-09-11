import { config, runTag } from '../../../support/config';

describe('API login', { retries: 0 }, () => {
  for (const useSecondUser of [false, true]) {
    it(`keeps ${
      useSecondUser ? 'an explicitly selected' : 'the default'
    } user authenticated during API setup without browser fetches`, () => {
      const user = useSecondUser ? config.user2 : config.user;
      const browserRequests: string[] = [];

      // cy.request() bypasses cy.intercept(). Any matching request here is
      // background browser activity that could concurrently replace cookies.
      cy.intercept({ pathname: '/api/auth/session' }, (req) => {
        browserRequests.push(req.url);
      });
      cy.intercept({ pathname: '/api/v1/**' }, (req) => {
        browserRequests.push(req.url);
      });

      if (useSecondUser) {
        cy.apiLogin(user.email, user.password || config.user.password);
      } else {
        cy.apiLogin();
      }

      // Exercise real middleware/session-cookie renewal immediately after
      // login, including a second request using the newly issued cookie.
      cy.request('POST', '/api/v1/registrars', {
        name: `API login regression registrar ${runTag()}`,
        namespace: `api-login-${runTag()}`,
        url: 'https://example.com',
      }).then(({ status, body }) => {
        expect(status).to.eq(201);
        cy.request(`/api/v1/registrars/${body.id}`).its('status').should('eq', 200);
      });

      cy.request('/api/auth/session').then(({ body }) => {
        expect(body.user.email).to.eq(user.email);
        expect(body.error).to.be.undefined;
        expect(browserRequests, 'browser session/API requests during API login and setup').to.deep.equal([]);
      });

      // The landing-page replacement must not intercept later UI visits.
      cy.visit('/');
      cy.location('pathname').should('eq', '/dashboard');
    });
  }
});
