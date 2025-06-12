import IssuePage from 'cypress/page/issuePage';
import { DPP_LINK_TYPE } from '../../../../constant';

class DPPIssueFlow extends IssuePage {
  testGenerateDPPWorkflow() {
    this.generateWorkflow(
      'Orchard Facility',
      'Generate DPP',
      'DigitalProductPassport',
      'apps',
    );
  }

  testUNTPTestSuite() {
    this.runUntpTest('digitalProductPassport', 'v0.6.0');
  }
}

describe('Issue DPP end-to-end testing flow', () => {
  const dppTest = new DPPIssueFlow();

  beforeEach(() => {
    dppTest.beforeAll();
  });

  it('should access the right the app config data', () => {
    dppTest.testAppConfig();
  });

  it('should visit the homepage, navigate to "Orchard Facility", handle API calls, and show success message', () => {
    dppTest.testGenerateDPPWorkflow();
  });

  it('Verify linkType', () => {
    dppTest.verifyLinkType(DPP_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for DPP', () => {
    dppTest.testUNTPTestSuite();
  });
});
