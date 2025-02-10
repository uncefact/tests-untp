import IssuePage from 'cypress/page/issuePage';

class DFRIssueFlow extends IssuePage {
  testGenerateDFRWorkflow() {
    this.generateWorkflow(
      'General features',
      'Generate DFR',
      'DigitalFacilityRecord',
      'DigitalFacilityRecord_instance-v0.5.0.json',
      'generalFeatures',
    );
  }

  testUNTPTestSuite() {
    this.runUntpTest('digitalFacilityRecord', 'v0.5.0');
  }
}

describe('Issue DFR end-to-end testing flow', () => {
  before(() => {
    // Clear the lastCredential from Cypress environment after each test
    Cypress.env('lastCredential', undefined);
  });

  const dfrTest = new DFRIssueFlow();

  beforeEach(() => {
    dfrTest.beforeAll();
  });

  it('should access the right app config data', () => {
    dfrTest.testAppConfig();
  });

  it('should generate DFR', () => {
    dfrTest.testGenerateDFRWorkflow();
  });

  it('Verify linkType for DFR', () => {
    dfrTest.verifyLinkType('http://localhost:3000/gs1/gln/9359502000034');
  });

  it('Runs testing UNTP test suite for DFR', () => {
    dfrTest.testUNTPTestSuite();
  });
});
