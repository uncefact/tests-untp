import { APP_CONFIG_FEATURE_APP, DIGITAL_TRACEABILITY_EVENT, ISSUE_TRACEABILITY_ASSOCIATION_EVENT, ORCHARD_FACILITY, TRACEABILITY_LINK_TYPE } from 'constant';
import IssuePage from 'cypress/page/issuePage';

const associationEvent = new IssuePage();

describe('Issue Digital Traceability Association Event end-to-end testing flow', () => {
  beforeEach(() => {
    associationEvent.beforeAll();
  });

  it('should access the right the app config data', () => {
    associationEvent.testAppConfig();
  });

  it('should visit the homepage, navigate to "Orchard Facility", handle API calls, and show success message', () => {
    associationEvent.generateWorkflow(
      ORCHARD_FACILITY,
      ISSUE_TRACEABILITY_ASSOCIATION_EVENT,
      DIGITAL_TRACEABILITY_EVENT,
      APP_CONFIG_FEATURE_APP,
    );
  
  });

  it('Verify linkType', () => {
    associationEvent.verifyLinkType(TRACEABILITY_LINK_TYPE);
  });

  it('Runs testing UNTP test suite for Digital Traceability Association Event', () => {
    associationEvent.runUntpTest('digitalTraceabilityEvent', 'v0.5.0');
  });
});
