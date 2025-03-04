// Load app config
Cypress.Commands.add('loadAppConfig', () => {
  return cy.fixture('app-config.json').then((data) => {
    Cypress.env('AppConfig', data);
    return data;
  });
});

// Navigate to a specific page
Cypress.Commands.add('navigateTo', (page) => {
  cy.contains('a', page).should('be.visible').and('not.be.disabled').click();
  cy.url().should('include', `/${page.toLowerCase().replace(/\s+/g, '-')}`);
});

// Intercept an API call
Cypress.Commands.add('interceptAPI', (method, url, alias) => {
  cy.intercept(method, url).as(alias);
});

// Wait for an API call and check its status
Cypress.Commands.add('waitForAPIResponse', (alias, expectedStatus) => {
  cy.wait('@' + alias, { timeout: 20000 }).then((interception) => {
    expect(interception?.response?.statusCode).to.eq(expectedStatus);
  });
});

// Check for success toast
Cypress.Commands.add('verifySuccessToast', (successMessage) => {
  cy.get('.Toastify__toast').should('be.visible').and('contain', successMessage);
});

// Write to file
Cypress.Commands.add('writeToFile', (fileName, data) => {
  return cy.task('writeToFile', { fileName, data });
});

// Verify link type
Cypress.Commands.add('verifyLinkType', (url) => {
  cy.request('GET', url).then((response) => {
    expect(response.status).to.eq(200);
  });
});

// Verify file download
Cypress.Commands.add('verifyFileDownload', (buttonName, filePath) => {
  cy.contains('button', buttonName).click();
  cy.readFile(filePath).should('exist');
  cy.task('deleteFile', filePath);
});
