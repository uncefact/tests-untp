/**
 * Tier 2 UNTP validation tests
 * Validates credentials against UNTP-specific schemas.
 */

const { expect, registerUNTPTestSuite } = untpTestSuite.setupUNTPTests();

registerUNTPTestSuite((credentialState) => {
  describe('Tier 2 - UNTP Schema Validation tag:tier2 tag:untp', () => {
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

        it('should validate against the related UNTP schema tag:schema tag:untp-validation', async () => {
          // Use the existing utility function to determine UNTP credential type
          const untpType = untpTestSuite.getUNTPCredentialType(parsedCredential);

          // Assert that we can determine a UNTP credential type
          expect(untpType, 'Should be able to determine UNTP credential type').to.be.a('string');

          // Get the appropriate UNTP schema URL for this credential type
          const schemaUrl = await untpTestSuite.getSchemaUrlForCredential(parsedCredential, untpType);

          // Assert that we can determine a UNTP schema URL for this credential
          expect(schemaUrl, 'Should be able to determine UNTP schema URL for credential').to.be.a('string');

          // Validate the credential against its specific UNTP schema
          await expect(parsedCredential, `${fileName} did not match schema ${schemaUrl}`).to.match.schema(schemaUrl);
        });
      });
    });
  });
});
