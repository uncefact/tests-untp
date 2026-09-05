// Not a functional test — this spec exists purely to surface report versioning metadata
// (app/test-suite versions, dependent component images, runtime) inside the HTML report itself
// (as this test's expandable "Context" block), alongside the same data already written to
// run-info.json by cypress.config.ts. Named to sort first so it's the first thing a reader sees.
describe('Report metadata', () => {
  it('records the tested app, test suite, dependent component, and runtime versions', () => {
    cy.addTestContext({ title: 'App & test suite', value: Cypress.env('REPORT_META') });
    cy.addTestContext({ title: 'Dependent components', value: Cypress.env('COMPONENT_VERSIONS') });
    cy.addTestContext({ title: 'Runtime', value: Cypress.env('RUNTIME_INFO') });
  });
});
