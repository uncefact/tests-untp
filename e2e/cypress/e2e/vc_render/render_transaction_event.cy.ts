import {
  APP_CONFIG_FEATURE_APP,
  DIGITAL_TRACEABILITY_EVENT,
  ISSUE_TRANSACTION_EVENT,
  APP_NAME,
  TRANSACTION_EVENT_LINK_TYPE,
} from 'constant';
import IssuePage from 'cypress/page/issuePage';
import RenderPage from 'cypress/page/renderPage';

const transactionEventIssue = new IssuePage();
const transactionEventRender = new RenderPage();

describe('Render Transaction Event end-to-end testing flow', () => {
  describe('Issue Transaction Event', () => {
    beforeEach(() => {
      transactionEventIssue.beforeAll();
    });

    it('should issue Transaction Event', () => {
      transactionEventIssue.generateWorkflow(
        APP_NAME,
        ISSUE_TRANSACTION_EVENT,
        DIGITAL_TRACEABILITY_EVENT,
        APP_CONFIG_FEATURE_APP,
      );
    });
  });

  describe('should render Transaction Event', () => {
    beforeEach(() => {
      cy.visit(TRANSACTION_EVENT_LINK_TYPE);
    });

    it('should displays the correct page title and content', () => {
      transactionEventRender.verifyPageTitleAndContent();
    });

    it('should checks the functionality of the RENDERED, JSON, and DOWNLOAD buttons/links', () => {
      transactionEventRender.verifyButtonsVisibilityAndText();
    });

    it('should download VC when clicking on download', () => {
      transactionEventRender.verifyDownloadVC();
    });

    it('should render template when content is exist', () => {
      transactionEventRender.verifyTemplateRenderingWhenContentExists();
    });

    it('should not render any content when template is empty', () => {
      transactionEventRender.verifyNoContentRenderingWhenTemplateIsEmpty();
    });

    it('should display JSON content when JSON button is clicked', () => {
      transactionEventRender.verifyJSONContentDisplay();
    });
  });
});
