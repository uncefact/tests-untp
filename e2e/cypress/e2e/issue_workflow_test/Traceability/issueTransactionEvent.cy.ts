import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_TRANSACTION_EVENT,
  APP_NAME,
  TRANSACTION_EVENT_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';

const transactionEvent = new IssuePage();

describe('Issue Transaction Event end-to-end testing flow', () => {
  beforeEach(() => {
    transactionEvent.beforeAll();
  });

  it('should access the right the app config data', () => {
    transactionEvent.testAppConfig();
  });

  it('should issue Transaction Event', () => {
    transactionEvent.generateWorkflow(
      APP_NAME,
      ISSUE_TRANSACTION_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  });

  it('Verify linkType', () => {
    transactionEvent.verifyLinkType(TRANSACTION_EVENT_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Transaction Event', () => {
    transactionEvent.runUntpTest('digitalTraceabilityEvent', 'v0.6.0');
  });
});
