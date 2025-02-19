import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_TRACEABILITY_OBJECT_EVENT,
  ORCHARD_FACILITY,
  TRACEABILITY_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';

const objectEvent = new IssuePage();

describe('Issue Digital Traceability Object Event end-to-end testing flow', () => {
  beforeEach(() => {
    objectEvent.beforeAll();
  });

  it('should access the right the app config data', () => {
    objectEvent.testAppConfig();
  });

  it('should visit the homepage, navigate to "Orchard Facility", handle API calls, and show success message', () => {
    objectEvent.generateWorkflow(
      ORCHARD_FACILITY,
      ISSUE_TRACEABILITY_OBJECT_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  });

  it('Verify linkType', () => {
    objectEvent.verifyLinkType(TRACEABILITY_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Digital Traceability Object Event', () => {
    objectEvent.runUntpTest('digitalTraceabilityEvent', 'v0.5.0');
  });
});
