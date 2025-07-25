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
    // Always include a basic smoke test
    it('dummy test should pass tag:basic tag:smoke', () => {
      expect(true).to.be.true;
    });

    it('should have access to credential state tag:basic tag:integration', () => {
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

    // Dynamically create individual test cases for each credential file
    if (credentialState.hasCredentials()) {
      const allCredentials = credentialState.getAllCredentials();

      allCredentials.forEach(([fileName, content]) => {
        describe(`${fileName}`, () => {
          let parsedCredential;

          before(() => {
            // Parse the credential once for this test suite
            parsedCredential = JSON.parse(content);
          });

          it('should validate JSON structure tag:json tag:validation', () => {
            expect(content, `File ${fileName} should have content`).to.be.a('string');
            expect(parsedCredential, `File ${fileName} should be an object`).to.be.an('object');
          });

          it('should validate JSON-LD context tag:jsonld tag:validation', () => {
            // Check for @context property (JSON-LD requirement)
            if (parsedCredential['@context']) {
              expect(parsedCredential['@context'], `File ${fileName} @context should be array or string`).to.satisfy(
                (ctx) => Array.isArray(ctx) || typeof ctx === 'string',
              );
            }

            // Check for type property (VerifiableCredential requirement)
            if (parsedCredential.type) {
              expect(parsedCredential.type, `File ${fileName} type should be array or string`).to.satisfy(
                (type) => Array.isArray(type) || typeof type === 'string',
              );

              // If it's an array, check if it includes VerifiableCredential
              if (Array.isArray(parsedCredential.type)) {
                expect(parsedCredential.type, `File ${fileName} should include VerifiableCredential type`).to.include(
                  'VerifiableCredential',
                );
              }
            }
          });

          it('should have basic credential properties tag:basic tag:validation', () => {
            // Basic structural checks
            expect(parsedCredential, `File ${fileName} should be an object`).to.be.an('object');

            // Should have an id or identifier
            const hasId = parsedCredential.id || parsedCredential.identifier;
            expect(hasId, `File ${fileName} should have an id or identifier`).to.exist;
          });

          it('should have W3C Verifiable Credential structure tag:w3c tag:validation', () => {
            // Check for required W3C VC properties
            expect(parsedCredential, `File ${fileName} should have type property`).to.have.property('type');
            expect(parsedCredential, `File ${fileName} should have credentialSubject property`).to.have.property(
              'credentialSubject',
            );
            expect(parsedCredential, `File ${fileName} should have issuer property`).to.have.property('issuer');
          });
        });
      });
    } else {
      // Fallback test when no credentials are available - this should never happen
      it('should fail when no credential files are available tag:basic tag:error', () => {
        expect.fail('No credential files available - this indicates a bug in the test loading architecture');
      });
    }
  });
});
