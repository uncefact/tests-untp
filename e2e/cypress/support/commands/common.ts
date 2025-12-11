after(() => {
  if (!Cypress.env('SKIP_MINIO')) {
  cy.task('clearObjectStore', { bucketName: Cypress.env('idrBucketName'), prefix: 'gs1', minioConfig: Cypress.env('idrMinioConfig') });
}
  Cypress.env('lastCredential', undefined);
});
