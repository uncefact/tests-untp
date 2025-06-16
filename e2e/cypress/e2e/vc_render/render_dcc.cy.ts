import {
  APP_CONFIG_GENERAL_FEATURES,
  DCC_LINK_TYPE,
  DIGITAL_CONFORMITY_CREDENTIAL,
  GENERAl_FEATURES,
  ISSUE_DCC,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const dccIssue = new IssuePage();
const dccRender = new RenderPage();

describe('Render DCC end-to-end testing flow', () => {
  describe('Issue DCC', () => {
    beforeEach(() => {
      dccIssue.beforeAll();
    });

    it('should issue DCC', () => {
      dccIssue.generateWorkflow(
        GENERAl_FEATURES,
        ISSUE_DCC,
        DIGITAL_CONFORMITY_CREDENTIAL,
        APP_CONFIG_GENERAL_FEATURES,
      );
    });
  });

  describe('should render DCC', () => {
    beforeEach(() => {
      cy.visit(DCC_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      dccRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      dccRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      dccRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      dccRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      dccRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      dccRender.verifyJSONContentDisplay();
    });
  });
});
