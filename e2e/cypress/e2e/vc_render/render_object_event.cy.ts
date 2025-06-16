import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  APP_NAME,
  ISSUE_OBJECT_EVENT,
  OBJECT_EVENT_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const objectEventIssue = new IssuePage();
const objectEventRender = new RenderPage();

describe('Render Object Event end-to-end testing flow', () => {
  describe('Issue Object Event', () => {
    beforeEach(() => {
      objectEventIssue.beforeAll();
    });

    it('should issue Object Event', () => {
      objectEventIssue.generateWorkflow(
        APP_NAME,
        ISSUE_OBJECT_EVENT,
        DIGITAL_TRACEABILITY_EVENT,
        APP_CONFIG_FEATURE_APP,
      );
    });
  });

  describe('should render Object Event', () => {
    beforeEach(() => {
      cy.visit(OBJECT_EVENT_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      objectEventRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      objectEventRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      objectEventRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      objectEventRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      objectEventRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      objectEventRender.verifyJSONContentDisplay();
    });
  });
});
