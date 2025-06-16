import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_OBJECT_EVENT,
  OBJECT_EVENT_LINK_TYPE,
  APP_NAME,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';

const objectEvent = new IssuePage();

describe('Issue Object Event end-to-end testing flow', () => {
  beforeEach(() => {
    objectEvent.beforeAll();
  });

  it('should access the right the app config data', () => {
    objectEvent.testAppConfig();
  });

  it('should issue Object Event', () => {
    objectEvent.generateWorkflow(
      APP_NAME,
      ISSUE_OBJECT_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  });

  it('Verify linkType', () => {
    objectEvent.verifyLinkType(OBJECT_EVENT_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Object Event', () => {
    objectEvent.runUntpTest('digitalTraceabilityEvent', 'v0.6.0');
  });
});
