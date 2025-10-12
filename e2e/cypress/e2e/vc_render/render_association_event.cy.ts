import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  APP_NAME,
  ISSUE_ASSOCIATION_EVENT,
  ASSOCIATION_EVENT_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const associationEventIssue = new IssuePage();
const associationEventRender = new RenderPage();

describe('Render Association Event end-to-end testing flow', () => {
  describe('Issue Association Event', () => {
    beforeEach(() => {
      associationEventIssue.beforeAll();
    });

    it('should issue Association Event', () => {
      associationEventIssue.generateWorkflow(
        APP_NAME,
        ISSUE_ASSOCIATION_EVENT,
        DIGITAL_TRACEABILITY_EVENT,
        APP_CONFIG_FEATURE_APP,
      );
    });
  });

  describe('should render Association Event', () => {
    beforeEach(() => {
      cy.visit(ASSOCIATION_EVENT_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      associationEventRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      associationEventRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      associationEventRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      associationEventRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      associationEventRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      associationEventRender.verifyJSONContentDisplay();
    });
  });
});
