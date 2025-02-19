import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_PRODUCT_PASSPORT,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_DPP,
  MOVE_TO_NEXT_FACILITY,
  ORCHARD_FACILITY,
  TRACEABILITY_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';

const transactionEvent = new IssuePage();
const dppIssue = new IssuePage();

describe('Issue Digital Traceability Transaction Event end-to-end testing flow', () => {
  beforeEach(() => {
    transactionEvent.beforeAll();
    cy.clearLocalStorage();
  });

  it('should access the right the app config data', () => {
    transactionEvent.testAppConfig();
  });

  it('should issue DPP first and then issue Digital Traceability Transaction Event', () => {
    dppIssue.generateWorkflow(ORCHARD_FACILITY, ISSUE_DPP, DIGITAL_PRODUCT_PASSPORT, APP_CONFIG_FEATURE_APP);

    cy.visit('/');

    transactionEvent.generateWorkflow(
      ORCHARD_FACILITY,
      MOVE_TO_NEXT_FACILITY,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  });

  it('Verify linkType', () => {
    transactionEvent.verifyLinkType(TRACEABILITY_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Digital Traceability Transaction Event', () => {
    transactionEvent.runUntpTest('digitalTraceabilityEvent', 'v0.5.0');
  });
});
