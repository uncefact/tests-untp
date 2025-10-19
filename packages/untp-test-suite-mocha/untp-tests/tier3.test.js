/**
 * Tier 3 UNTP validation tests
 * Validates DPP claims to have attested by Digital Conformity Credentials.
 */

const { expect, registerUNTPTestSuite } = untpTestSuite.setupUNTPTests();

registerUNTPTestSuite((credentialState) => {
  let n3store;

  describe('Tier 3 - UNTP RDF Validation tag:tier3 tag:untp', () => {
    before(async function() {
      this.timeout(5000); // Standard timeout for setup
      n3store = untpTestSuite.createN3Store(); // Initialize n3store once per suite run
    });

    it('should have access to credential state tag:basic tag:integration', () => {
      expect(credentialState.hasCredentials()).to.be.true;
    });

    const allCredentials = credentialState.getAllCredentials();

    allCredentials.forEach(([filePath, content]) => {
      console.log(filePath);
      const credential = JSON.parse(content);

      it(`${filePath} should be a valid RDF document. tag:rdf`, async () => {
        // Assert that we can convert json-ld to N-quads
        await expect(credential).to.be.a.validRDFDocument;
        // Pass the initialized n3store to storeQuads
        await untpTestSuite.storeQuads(credential, filePath, n3store);
      }).timeout(30000)  // Increased timeout: Retrieving context over network takes long time
    })

    describe('Verifications', () => {
      before(async function() {
        this.timeout(35000); // Allow extra time for inferences
        // Call runInferences with the n3store
        const inferenceSuccess = await untpTestSuite.runInferences(n3store);
        // Use n3store.size
        console.log(`Inference succeded: ${inferenceSuccess}. Total RDF quads in graph: ${n3store.size}`);
        expect(inferenceSuccess, 'Inference process should succeed').to.be.true;
      });

      it('should verify all product claims and issuer trust chains', async () => {
        // Call listAllProducts with the n3store
        const products = await untpTestSuite.listAllProducts(n3store);
        expect(products, 'Should find products to verify').to.not.be.empty;

        for (const product of products) {
          // Call getUnattestedIssuersForProduct with the n3store
          const unattestedIssuers = await untpTestSuite.getUnattestedIssuersForProduct(
            product.dppId,
            n3store,
            untpTestSuite.trustedDIDs
          );
          expect(unattestedIssuers, `Product \"${product.name}\": all issuers should be attested`).to.be.empty;

          for (const claim of product.claims) {
            const claimTopic = claim.topic.split('/').at(-1);
            expect(claim.verified, `Product \"${product.name}\", Claim \"${claimTopic}\": should be verified`).to.be.true;
            expect(claim.criteria.length, `Product \"${product.name}\", Claim \"${claimTopic}\": should have at least one criterion`).to.be.above(0);

            for (const [index, criterion] of claim.criteria.entries()) {
              expect(criterion.verifierName, `Product \"${product.name}\", Claim \"${claimTopic}\", Criterion \"${criterion.name}\": should be verified in Digital Conformity Credential`).to.not.be.undefined;
            }
          }
        }
      });
    });
  });
});
