import { DIGITAL_TRACEABILITY_EVENT, ISSUE_TRACEABILITY_ASSOCIATION_EVENT, ORCHARD_FACILITY } from 'constant';
import IssuePage from 'cypress/page/issuePage';

class TransformationEventIssueFlow extends IssuePage {
  testGenerateDPPWorkflow() {
    this.generateWorkflow(
      ORCHARD_FACILITY,
      ISSUE_TRACEABILITY_ASSOCIATION_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      'DigitalTraceabilityEvent-v0.5.0.json',
      'apps',
    );
  }

  testUNTPTestSuite() {
    this.runUntpTest('digitalTraceabilityEvent', 'v0.5.0');
  }
}

describe('Issue Digital Traceability Object Event end-to-end testing flow', () => {
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

  it('Runs testing UNTP test suite for Digital Traceability Object Event', () => {
    transformationEventTest.testUNTPTestSuite();
  });
});
