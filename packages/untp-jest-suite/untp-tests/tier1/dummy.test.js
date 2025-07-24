/**
 * Dummy test for Tier 1 UNTP validation
 * This is a placeholder test to verify Mocha execution works with grep tags
 * Tests now access uploaded credential data from FileList
 */

// Use global test helper - no environment detection needed
const { expect, credentialState } = setupUNTPTests();

describe('Tier 1 - W3C Verifiable Credential Validation tag:tier1 tag:w3c', () => {
  it('dummy test should pass tag:basic tag:smoke', () => {
    expect(true).to.be.true;
  });

  it('should have access to credential files tag:basic tag:integration', () => {
    // Access credential data from shared state module
    expect(credentialState.hasCredentials()).to.be.a('boolean');

    if (credentialState.hasCredentials()) {
      // Test first credential file
      const allCredentials = credentialState.getAllCredentials();
      expect(allCredentials).to.be.an('array');
      expect(allCredentials.length).to.be.greaterThan(0);

      const [firstFileName, firstContent] = allCredentials[0];
      expect(firstContent).to.be.a('string');

      const parsedCredential = JSON.parse(firstContent);
      expect(parsedCredential).to.be.an('object');
    }
  });

  it('should validate JSON structure for all credential files tag:json tag:validation', () => {
    if (!credentialState.hasCredentials()) {
      console.log('No credential files uploaded - skipping validation');
      return;
    }

    // Test each uploaded credential file
    for (const [fileName, content] of credentialState.getAllCredentials()) {
      expect(content, `File ${fileName} should have content`).to.be.a('string');

      // Should parse as valid JSON
      let parsedJson;
      expect(() => {
        parsedJson = JSON.parse(content);
      }, `File ${fileName} should be valid JSON`).to.not.throw();

      expect(parsedJson, `File ${fileName} should be an object`).to.be.an('object');
    }
  });

  it('should validate JSON-LD context in credential files tag:jsonld tag:validation', () => {
    if (!credentialState.hasCredentials()) {
      console.log('No credential files uploaded - skipping JSON-LD validation');
      return;
    }

    // Test each uploaded credential file for JSON-LD structure
    for (const [fileName, content] of credentialState.getAllCredentials()) {
      const credential = JSON.parse(content);

      // Check for @context property (JSON-LD requirement)
      if (credential['@context']) {
        expect(credential['@context'], `File ${fileName} @context should be array or string`).to.satisfy(
          (ctx) => Array.isArray(ctx) || typeof ctx === 'string',
        );
      }

      // Check for type property (VerifiableCredential requirement)
      if (credential.type) {
        expect(credential.type, `File ${fileName} type should be array or string`).to.satisfy(
          (type) => Array.isArray(type) || typeof type === 'string',
        );

        // If it's an array, check if it includes VerifiableCredential
        if (Array.isArray(credential.type)) {
          expect(credential.type, `File ${fileName} should include VerifiableCredential type`).to.include(
            'VerifiableCredential',
          );
        }
      }
    }
  });
});
