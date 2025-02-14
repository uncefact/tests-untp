import IssuePage from 'cypress/page/issuePage';

class TransformationEventIssueFlow extends IssuePage {
  testGenerateDPPWorkflow() {
    this.generateWorkflow(
      'Orchard Facility',
      'Issue Traceability Event',
      'DigitalTraceabilityEvent',
      'DigitalTraceabilityEvent-v0.5.0.json',
      'apps',
    );
  }

  testUNTPTestSuite() {
    this.runUntpTest('digitalTraceabilityEvent', 'v0.5.0');
  }
}

describe('Issue TransformationEvent end-to-end testing flow', () => {
  const transformationEventTest = new TransformationEventIssueFlow();

  beforeEach(() => {
    transformationEventTest.beforeAll();
  });

  it('should access the right the app config data', () => {
    transformationEventTest.testAppConfig();
  });

  it('should visit the homepage, navigate to "Orchard Facility", handle API calls, and show success message', () => {
    transformationEventTest.testGenerateDPPWorkflow();
  });

  it('Verify linkType', () => {
    const checkLinkTypeURL = 'http://localhost:3000/gs1/01/09359502000034/21/123456';
    transformationEventTest.verifyLinkType(checkLinkTypeURL);
  });

  it('Runs testing UNTP test suite for TransformationEvent', () => {
    transformationEventTest.testUNTPTestSuite();
  });
});
