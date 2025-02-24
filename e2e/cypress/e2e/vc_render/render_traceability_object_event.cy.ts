import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  TRACEABILITY_LINK_TYPE,
  ISSUE_TRACEABILITY_OBJECT_EVENT,
  ORCHARD_FACILITY,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const traceabilityIssue = new IssuePage();
const traceabilityRender = new RenderPage();

describe('Render DTE Object Event end-to-end testing flow', () => {
  describe('Issue DTE Object Event', () => {
    beforeEach(() => {
      traceabilityIssue.beforeAll();
    });

    it('should access the right the app config data', () => {
      traceabilityIssue.testAppConfig();
    });

    it('should issue DTE Object Event', () => {
      traceabilityIssue.generateWorkflow(
        ORCHARD_FACILITY,
        ISSUE_TRACEABILITY_OBJECT_EVENT,
        DIGITAL_TRACEABILITY_EVENT,
        APP_CONFIG_FEATURE_APP,
      );
    });
  });

  describe('should render DTE Object Event', () => {
    beforeEach(() => {
      cy.visit(TRACEABILITY_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      traceabilityRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      traceabilityRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      traceabilityRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      traceabilityRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      traceabilityRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      traceabilityRender.verifyJSONContentDisplay();
    });
  });
});
