/**
 * Dummy test for Tier 1 UNTP validation
 * This is a placeholder test to verify Mocha execution works with grep tags
 * Uses registerUNTPTestSuite to defer test registration until after credentials are loaded
 */

// Use global test helper from namespace - no environment detection needed
const { expect, credentialState, registerUNTPTestSuite } = (
  typeof window !== 'undefined' ? window : global
).untpTestSuite.setupUNTPTests();

// Register test suite to be executed after credentials are loaded
registerUNTPTestSuite(() => {
  describe('Tier 1 - W3C Verifiable Credential Validation tag:tier1 tag:w3c', () => {
    it('should have access to credential state tag:basic tag:integration', () => {
      expect(credentialState.hasCredentials()).to.be.true;
    });

    const allCredentials = credentialState.getAllCredentials();

    allCredentials.forEach(([fileName, content]) => {
      describe(`${fileName}`, () => {
        let parsedCredential;

        before(() => {
          // Parse the credential once for this test suite
          parsedCredential = JSON.parse(content);
        });

        it('should be a valid JSON-LD document tag:jsonld tag:json', async () => {
          await expect(parsedCredential).to.be.a.validJSONLDDocument;
        });
      });
    });
  });
});
