import { DFR_LINK_TYPE } from 'constant';
import IssuePage from 'cypress/page/issuePage';

class DFRIssueFlow extends IssuePage {
  testGenerateDFRWorkflow() {
    this.generateWorkflow(
      'General features',
      'Generate DFR',
      'DigitalFacilityRecord',
      'generalFeatures',
    );
  }

  testUNTPTestSuite() {
    this.runUntpTest('digitalFacilityRecord', 'v0.6.0');
  }
}

describe('Issue DFR end-to-end testing flow', () => {
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
    dfrTest.verifyLinkType(DFR_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for DFR', () => {
    dfrTest.testUNTPTestSuite();
  });
});
