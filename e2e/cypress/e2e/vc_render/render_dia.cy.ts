import {
  APP_CONFIG_GENERAL_FEATURES,
  DIA_LINK_TYPE,
  DIGITAL_FACILITY_RECORD,
  GENERAl_FEATURES,
  ISSUE_DIA,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const diaIssue = new IssuePage();
const diaRender = new RenderPage();

describe('Render DIA end-to-end testing flow', () => {
  describe('Issue DIA', () => {
    beforeEach(() => {
      diaIssue.beforeAll();
    });

    it('should issue DIA', () => {
      diaIssue.generateWorkflow(GENERAl_FEATURES, ISSUE_DIA, DIGITAL_FACILITY_RECORD, APP_CONFIG_GENERAL_FEATURES);
    });
  });

  describe('should render DIA', () => {
    beforeEach(() => {
      cy.visit(DIA_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      diaRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      diaRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      diaRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      diaRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      diaRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      diaRender.verifyJSONContentDisplay();
    });
  });
});
