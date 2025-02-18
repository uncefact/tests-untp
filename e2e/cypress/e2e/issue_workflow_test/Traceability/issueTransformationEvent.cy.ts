import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_TRACEABILITY_TRANSFORMATION_EVENT,
  ORCHARD_FACILITY,
  TRACEABILITY_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';

const transformationEvent = new IssuePage();

describe('Issue Digital Traceability Transformation Event end-to-end testing flow', () => {
  beforeEach(() => {
    transformationEvent.beforeAll();
  });

  it('should access the right the app config data', () => {
    transformationEvent.testAppConfig();
  });

  it('should visit the homepage, navigate to "Orchard Facility", handle API calls, and show success message', () => {
    transformationEvent.generateWorkflow(
      ORCHARD_FACILITY,
      ISSUE_TRACEABILITY_TRANSFORMATION_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  });

  it('Verify linkType', () => {
    transformationEvent.verifyLinkType(TRACEABILITY_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Digital Traceability Transformation Event', () => {
    transformationEvent.runUntpTest('digitalTraceabilityEvent', 'v0.5.0');
  });
});
