after(() => {
  cy.task('clearObjectStore', {
    bucketName: Cypress.env('idrBucketName'),
    prefix: Cypress.env('idrGS1Prefix'),
    minioConfig: Cypress.env('idrMinioConfig'),
  });
  Cypress.env('lastCredential', undefined);
});
