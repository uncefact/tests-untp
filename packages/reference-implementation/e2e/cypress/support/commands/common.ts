import { config, runTag } from '../config';

after(() => {
  if (config.capabilities.dbAccess) {
    cy.task('clearObjectStore', {
      bucketName: Cypress.env('idrBucketName'),
      prefix: 'gs1',
      tag: runTag(),
      minioConfig: Cypress.env('idrMinioConfig'),
    }).then((result) => {
      const cleanupResult = result as { success: boolean; message?: string };
      expect(cleanupResult.success, cleanupResult.message ?? 'The tagged object-store cleanup failed').to.be.true;
    });
  }
  Cypress.env('lastCredential', undefined);
});
