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
import RenderPage from 'cypress/page/renderPage';

const traceabilityIssue = new IssuePage();
const traceabilityRender = new RenderPage();
const dppIssue = new IssuePage();

describe('Render DTE Transaction Event end-to-end testing flow', () => {
  describe('Issue DTE Transaction Event', () => {
    beforeEach(() => {
      traceabilityIssue.beforeAll();
    });

    it('should access the right the app config data', () => {
      traceabilityIssue.testAppConfig();
    });

    it('should issue DTE Transaction Event', () => {
      dppIssue.generateWorkflow(ORCHARD_FACILITY, ISSUE_DPP, DIGITAL_PRODUCT_PASSPORT, APP_CONFIG_FEATURE_APP);

      cy.visit('/');
      traceabilityIssue.generateWorkflow(
        ORCHARD_FACILITY,
        MOVE_TO_NEXT_FACILITY,
        DIGITAL_TRACEABILITY_EVENT,
        APP_CONFIG_FEATURE_APP,
      );
    });
  });

  describe('should render DTE Transaction Event', () => {
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
