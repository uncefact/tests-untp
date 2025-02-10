import IssuePage from 'cypress/page/issuePage';

class DIAIssueFlow extends IssuePage {
  testGenerateDCCWorkflow() {
    this.generateWorkflow(
      'General features',
      'Generate DIA',
      'DigitalIdentityAnchor',
      'DigitalIdentityAnchor_instance-v0.2.1.json',
      'generalFeatures',
    );
  }

  testUNTPTestSuite() {
    this.logCurrentDir();
    this.runShellScript('./cypress/e2e/issue_workflow_test/DIA/test-untp-dia-scripts.sh');
    this.deleteFile('DigitalIdentityAnchor_instance-v0.2.1.json');
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

  it('should generate DCC', () => {
    diaTest.testGenerateDCCWorkflow();
  });

  it('Verify linkType for DCC', () => {
    diaTest.verifyLinkType('http://localhost:3000/gs1/01/09359502000010');
  });

  it('Runs testing UNTP test suite for DCC', () => {
    diaTest.testUNTPTestSuite();
  });
});
