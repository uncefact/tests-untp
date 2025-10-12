import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  APP_NAME,
  ISSUE_TRANSFORMATION_EVENT,
  TRANSFORMATION_EVENT_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const transformationEventIssue = new IssuePage();
const transformationEventRender = new RenderPage();

describe('Render Transformation Event end-to-end testing flow', () => {
  describe('Issue Transformation Event', () => {
    beforeEach(() => {
      transformationEventIssue.beforeAll();
    });

    it('should issue Transformation Event', () => {
      transformationEventIssue.generateWorkflow(
        APP_NAME,
        ISSUE_TRANSFORMATION_EVENT,
        DIGITAL_TRACEABILITY_EVENT,
        APP_CONFIG_FEATURE_APP,
      );
    });
  });

  describe('should render Transformation Event', () => {
    beforeEach(() => {
      cy.visit(TRANSFORMATION_EVENT_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      transformationEventRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      transformationEventRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      transformationEventRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      transformationEventRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      transformationEventRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      transformationEventRender.verifyJSONContentDisplay();
    });
  });
});
