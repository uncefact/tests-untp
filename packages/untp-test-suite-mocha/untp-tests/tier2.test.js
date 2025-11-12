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
        // Parse credential early to determine UNTP credential type for test naming
        const parsedCredential = JSON.parse(content);
        const untpType = untpTestSuite.getUNTPCredentialType(parsedCredential);

        it(`should validate against ${untpType} UNTP schema tag:schema`, async () => {
          // Assert that we can determine a UNTP credential type
          expect(untpType, 'Should be able to determine UNTP credential type').to.be.a('string');

          // Get the appropriate UNTP schema URL for this credential type
          const schemaUrl = await untpTestSuite.getSchemaUrlForCredential(parsedCredential, untpType);

          // Assert that we can determine a UNTP schema URL for this credential
          expect(schemaUrl, 'Should be able to determine UNTP schema URL for credential').to.be.a('string');

          // Validate the credential against its specific UNTP schema
          await expect(parsedCredential).to.match.schema(schemaUrl);
        });

        // Create individual tests for each extension type
        const extensionTypes = untpTestSuite.getExtensionTypes(parsedCredential);
        extensionTypes.forEach((extensionType) => {
          it(`should validate against ${extensionType} extension schema tag:schema tag:extension`, async () => {
            // Get the appropriate schema URL for this extension type
            const extensionSchemaUrl = await untpTestSuite.getSchemaUrlForCredential(parsedCredential, extensionType);

            // Check if we can determine a schema URL for this extension
            if (!extensionSchemaUrl) {
              throw new Error(
                `Unable to determine schema URL for extension type ${extensionType}: no mapping found for ${extensionType}`,
              );
            }

            // Validate the credential against the extension schema
            await expect(parsedCredential).to.match.schema(extensionSchemaUrl);
          });
        });
      });
    });
  });
});
