import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_AGGREGATION_EVENT,
  APP_NAME,
  AGGREGATION_EVENT_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';

const aggregationEvent = new IssuePage();

describe('Issue Aggregation Event end-to-end testing flow', () => {
  beforeEach(() => {
    aggregationEvent.beforeAll();
  });

  it('should access the right the app config data', () => {
    aggregationEvent.testAppConfig();
  });

  it('should issue Aggregation Event', () => {
    aggregationEvent.generateWorkflow(
      APP_NAME,
      ISSUE_AGGREGATION_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  });

  it('Verify linkType', () => {
    aggregationEvent.verifyLinkType(AGGREGATION_EVENT_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Aggregation Event', () => {
    aggregationEvent.runUntpTest('digitalTraceabilityEvent', 'v0.6.0');
  });
});
