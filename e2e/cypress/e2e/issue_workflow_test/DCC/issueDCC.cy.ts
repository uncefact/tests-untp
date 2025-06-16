import { DCC_LINK_TYPE } from 'constant';
import IssuePage from 'cypress/page/issuePage';

class DCCIssueFlow extends IssuePage {
  testGenerateDCCWorkflow() {
    this.generateWorkflow(
      'General features',
      'Generate DCC',
      'getConformityCredential',
      'generalFeatures',
    );
  }

  testUNTPTestSuite() {
    this.runUntpTest('digitalConformityCredential', 'v0.6.0');
  }
}

describe('Issue DCC end-to-end testing flow', () => {
  const dccTest = new DCCIssueFlow();

  beforeEach(() => {
    dccTest.beforeAll();
  });

  it('should access the right app config data', () => {
    dccTest.testAppConfig();
  });

  it('should generate DCC', () => {
    dccTest.testGenerateDCCWorkflow();
  });

  it('Verify linkType for DCC', () => {
    dccTest.verifyLinkType(DCC_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for DCC', () => {
    dccTest.testUNTPTestSuite();
  });
});
