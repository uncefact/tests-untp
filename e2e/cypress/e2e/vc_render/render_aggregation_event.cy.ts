import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  APP_NAME,
  ISSUE_AGGREGATION_EVENT,
  AGGREGATION_EVENT_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const aggregationEventIssue = new IssuePage();
const aggregationEventRender = new RenderPage();

describe('Render Aggregation Event end-to-end testing flow', () => {
  describe('Issue Aggregation Event', () => {
    beforeEach(() => {
      aggregationEventIssue.beforeAll();
    });

    it('should issue Aggregation Event', () => {
      aggregationEventIssue.generateWorkflow(
        APP_NAME,
        ISSUE_AGGREGATION_EVENT,
        DIGITAL_TRACEABILITY_EVENT,
        APP_CONFIG_FEATURE_APP,
      );
    });
  });

  describe('should render Aggregation Event', () => {
    beforeEach(() => {
      cy.visit(AGGREGATION_EVENT_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      aggregationEventRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      aggregationEventRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      aggregationEventRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      aggregationEventRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      aggregationEventRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      aggregationEventRender.verifyJSONContentDisplay();
    });
  });
});
