import { APP_CONFIG_FEATURE_APP, DIGITAL_PRODUCT_PASSPORT, DPP_LINK_TYPE, ISSUE_DPP, ORCHARD_FACILITY } from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const dppIssue = new IssuePage();
const dppRender = new RenderPage();

describe('Render DPP end-to-end testing flow', () => {
  describe('Issue DPP', () => {
    beforeEach(() => {
      dppIssue.beforeAll();
    });

    it('should access the right the app config data', () => {
      dppIssue.testAppConfig();
    });

    it('should issue DPP', () => {
      dppIssue.generateWorkflow(ORCHARD_FACILITY, ISSUE_DPP, DIGITAL_PRODUCT_PASSPORT, APP_CONFIG_FEATURE_APP);
    });
  });

  describe('should render DPP', () => {
    beforeEach(() => {
      cy.visit(DPP_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      dppRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      dppRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      dppRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      dppRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      dppRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      dppRender.verifyJSONContentDisplay();
    });
  });
});
