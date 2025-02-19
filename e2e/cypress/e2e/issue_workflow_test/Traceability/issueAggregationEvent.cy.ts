import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_TRACEABILITY_AGGREGATION_EVENT,
  ORCHARD_FACILITY,
  TRACEABILITY_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';

const aggregationEvent = new IssuePage();

describe('Issue Digital Traceability Aggregation Event end-to-end testing flow', () => {
  beforeEach(() => {
    aggregationEvent.beforeAll();
  });

  it('should access the right the app config data', () => {
    aggregationEvent.testAppConfig();
  });

  it('should visit the homepage, navigate to "Orchard Facility", handle API calls, and show success message', () => {
    aggregationEvent.generateWorkflow(
      ORCHARD_FACILITY,
      ISSUE_TRACEABILITY_AGGREGATION_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  });

  it('Verify linkType', () => {
    aggregationEvent.verifyLinkType(TRACEABILITY_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Digital Traceability Aggregation Event', () => {
    aggregationEvent.runUntpTest('digitalTraceabilityEvent', 'v0.5.0');
  });
});
