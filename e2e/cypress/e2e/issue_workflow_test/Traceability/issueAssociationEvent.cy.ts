import {
  APP_CONFIG_FEATURE_APP,
  ASSOCIATION_EVENT_LINK_TYPE,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_ASSOCIATION_EVENT,
  APP_NAME,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';

const associationEvent = new IssuePage();

describe('Issue Association Event end-to-end testing flow', () => {
  beforeEach(() => {
    associationEvent.beforeAll();
  });

  it('should access the right the app config data', () => {
    associationEvent.testAppConfig();
  });

  it('should issue Association Event', () => {
    associationEvent.generateWorkflow(
      APP_NAME,
      ISSUE_ASSOCIATION_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  });

  it('Verify linkType', () => {
    associationEvent.verifyLinkType(ASSOCIATION_EVENT_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Association Event', () => {
    associationEvent.runUntpTest('digitalTraceabilityEvent', 'v0.6.0');
  });
});
