// Protects: the readiness route stays reachable without a session in both tenant modes.
describe('Readiness', () => {
  it('answers 200 with a pass body and no-store to an unauthenticated caller', () => {
    cy.clearCookies();

    cy.request({ url: '/api/health/ready', failOnStatusCode: false }).then(({ status, body, headers }) => {
      expect(status).to.eq(200);
      expect(headers['cache-control']).to.eq('no-store');
      expect(body.timestamp).to.be.a('string');
      expect(body).to.deep.equal({
        status: 'pass',
        timestamp: body.timestamp,
        checks: { database: { status: 'pass' } },
      });
    });
  });
});
