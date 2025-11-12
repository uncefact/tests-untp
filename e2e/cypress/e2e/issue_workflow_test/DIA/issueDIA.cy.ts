import { DIA_LINK_TYPE } from 'constant';
import IssuePage from 'cypress/page/issuePage';

class DIAIssueFlow extends IssuePage {
  testGenerateDCCWorkflow() {
    this.generateWorkflow(
      'General features',
      'Generate DIA',
      'DigitalIdentityAnchor',
      'generalFeatures',
    );
  }

  testUNTPTestSuite() {
    this.runUntpTest('digitalIdentityAnchor', 'v0.6.0');
  }
}

describe('Issue DIA end-to-end testing flow', () => {
  const diaTest = new DIAIssueFlow();

  beforeEach(() => {
    diaTest.beforeAll();
  });

  it('should access the right app config data', () => {
    diaTest.testAppConfig();
  });

  it('should generate DIA', () => {
    diaTest.testGenerateDCCWorkflow();
  });

  it('Verify linkType for DIA', () => {
    diaTest.verifyLinkType(DIA_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for DIA', () => {
    diaTest.testUNTPTestSuite();
  });
});
