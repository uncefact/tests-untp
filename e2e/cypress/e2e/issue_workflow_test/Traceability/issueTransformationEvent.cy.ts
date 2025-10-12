import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_TRANSFORMATION_EVENT,
  APP_NAME,
  TRANSFORMATION_EVENT_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';

const transformationEvent = new IssuePage();

describe('Issue Transformation Event end-to-end testing flow', () => {
  beforeEach(() => {
    transformationEvent.beforeAll();
  });

  it('should access the right the app config data', () => {
    transformationEvent.testAppConfig();
  });

  it('should issue Transformation Event', () => {
    transformationEvent.generateWorkflow(
      APP_NAME,
      ISSUE_TRANSFORMATION_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  });

  it('Verify linkType', () => {
    transformationEvent.verifyLinkType(TRANSFORMATION_EVENT_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Transformation Event', () => {
    transformationEvent.runUntpTest('digitalTraceabilityEvent', 'v0.6.0');
  });
});
