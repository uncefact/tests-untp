after(() => {
  const idrBucketName = Cypress.env('idrBucketName');
  const idrGS1Prefix = Cypress.env('idrGS1Prefix');
  const idrMinioConfig = Cypress.env('idrMinioConfig');
  cy.task('clearObjectStore', { bucketName: idrBucketName, prefix: idrGS1Prefix, minioConfig: idrMinioConfig });
  Cypress.env('lastCredential', undefined);
});
