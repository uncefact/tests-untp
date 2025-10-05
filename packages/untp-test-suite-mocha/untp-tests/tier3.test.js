/**
 * Tier 3 UNTP validation tests
 * Validates DPP claims to have attested by Digital Conformity Credentials.
 */

const { expect, registerUNTPTestSuite } = untpTestSuite.setupUNTPTests();

registerUNTPTestSuite((credentialState) => {
  describe('Tier 3 - UNTP RDF Validation tag:tier3 tag:untp', () => {
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
        await untpTestSuite.storeQuads(credential, filePath)
      }).timeout(30000)  // Increased timeout: Retrieving context over network takes long time
    })


    it(`should run verifications`, async () => {

      const inferenceSuccess = await untpTestSuite.runInferences();
      console.log(`Inference succeded: ${inferenceSuccess}. Total RDF quads in graph: ${untpTestSuite.n3store.size}`);

      const products = await untpTestSuite.listAllProducts(untpTestSuite.n3store);

      for (const product of products) {
        const unattestedIssuers = await untpTestSuite.getUnattestedIssuersForProduct(
          product.dppId,
          untpTestSuite.n3store,
          untpTestSuite.trustedDIDs
        );

        describe(`Product: "${product.name}" (${product.id})`, () => {

          it('should have all issuers attested', ()=>{
            expect(unattestedIssuers).to.be.empty;
          })

          for (const claim of product.claims) {
            describe(`Claim ${claim.id} (topic: "${claim.topic.split('/').at(-1)}")`, () => {
              it(`Claim should be verified`, async () => {
                expect(claim.verified).to.be.true;
              })

              it(`have at least one criterion`, async () => {
                expect(claim.criteria.length).to.be.above(0);
              })

              for (const [index, criterion] of claim.criteria.entries()) {
                describe(`Criterion ${index}: "${criterion.name}"`, () => {
                  it(`should be verified in Digital Conformity Credential`, async () => {
                    expect(criterion.verifierName).to.not.be.undefined;
                  })
                })
              }
            })
          }
        })
      }
    })
  });
});
