/**
 * Tier 1 UNTP validation tests
 * Validates credentials as valid JSON-LD as well as valid W3C Verifiable Credentials.
 */

const { expect, registerUNTPTestSuite } = untpTestSuite.setupUNTPTests();

registerUNTPTestSuite((credentialState) => {
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

        it('should be a valid JSON-LD document tag:jsonld', async () => {
          await expect(parsedCredential).to.be.a.validJSONLDDocument;
        }).timeout(30000); // increased timeout: json-ld validation might take long time.

        it('should match the VerifiableCredential 1.1 schema tag:schema', async () => {
          // Get the W3C VerifiableCredential schema URL
          const schemaUrl = await untpTestSuite.getSchemaUrlForCredential(parsedCredential, 'VerifiableCredential');

          // Assert that we can determine a VerifiableCredential schema URL
          expect(schemaUrl, 'Should be able to determine VerifiableCredential schema URL').to.be.a('string');

          await expect(parsedCredential).to.match.schema(schemaUrl);
        });
      });
    });
  });
});
