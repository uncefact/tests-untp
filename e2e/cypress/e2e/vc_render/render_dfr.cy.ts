import {
  APP_CONFIG_GENERAL_FEATURES,
  DFR_LINK_TYPE,
  DIGITAL_FACILITY_RECORD,
  GENERAl_FEATURES,
  ISSUE_DFR,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const dfrIssue = new IssuePage();
const dfrRender = new RenderPage();

describe('Render DFR end-to-end testing flow', () => {
  describe('Issue DFR', () => {
    beforeEach(() => {
      dfrIssue.beforeAll();
    });

    it('should access the right the app config data', () => {
      dfrIssue.testAppConfig();
    });

    it('should issue DFR', () => {
      dfrIssue.generateWorkflow(GENERAl_FEATURES, ISSUE_DFR, DIGITAL_FACILITY_RECORD, APP_CONFIG_GENERAL_FEATURES);
    });
  });

  describe('should render DFR', () => {
    beforeEach(() => {
      cy.visit(DFR_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      dfrRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      dfrRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      dfrRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      dfrRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      dfrRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      dfrRender.verifyJSONContentDisplay();
    });
  });
});
