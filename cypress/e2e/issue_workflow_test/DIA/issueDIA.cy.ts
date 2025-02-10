describe('Issue DIA end-to-end testing flow', () => {
  let DIACredential = {};
  beforeEach(() => {
    // Load app config JSON
    cy.fixture('app-config.json').then((data) => {
      Cypress.env('AppConfig', data);
    });
  });

  it('should access the right app config data', () => {
    const AppConfig = Cypress.env('AppConfig');
    expect(AppConfig?.name).to.not.be.null;
    expect(AppConfig?.name).to.not.be.undefined;
  });

  it('should visit the homepage, navigate to "Generate DIA" thought "General features", handle API calls, and show success message', () => {
    const AppConfig = Cypress.env('AppConfig');
    cy.visit('/');

    cy.contains('a', 'General features').should('be.visible').and('not.be.disabled').click();

    cy.url().should('include', '/general-features');
    const feature = AppConfig.generalFeatures[0]?.features.find(
      (feature: { name: string }) => feature.name === 'Generate DIA',
    );

    const shemaDIA = feature?.components[0].props?.schema?.url ?? '';
    const appService = feature?.services[0]?.parameters[0] ?? {};
    cy.intercept('GET', shemaDIA).as('getIdentityAnchor');

    cy.contains('a', 'Generate DIA').should('be.visible').and('not.be.disabled').click();

    cy.wait('@getIdentityAnchor', { timeout: 20000 }).then((interception) => {
      expect(interception?.response?.statusCode).to.eq(200);
    });

    const API_ENDPOINT = {
      ISSUE_BITSTRING_STATUS_LIST: '/agent/issueBitstringStatusList',
      VCKit_URL: appService?.vckit?.vckitAPIUrl + '/credentials/issue',
      STORAGE_URL: appService?.storage?.url,
      IDR_URL: appService?.dlr?.dlrAPIUrl + appService?.dlr?.linkRegisterPath,
    };
    cy.intercept('POST', API_ENDPOINT.ISSUE_BITSTRING_STATUS_LIST).as('issueBitStringStatusList');
    cy.intercept('POST', API_ENDPOINT.VCKit_URL).as('issueCredentials');
    cy.intercept('POST', API_ENDPOINT.STORAGE_URL).as('storeVC');
    cy.intercept('POST', API_ENDPOINT.IDR_URL).as('linkResolverRegister');

    cy.contains('button', 'Submit').should('be.visible').and('not.be.disabled').click();

    cy.wait('@issueBitStringStatusList').then((interception) => {
      expect(interception?.response?.statusCode).to.eq(200);
      cy.log('Completed: issueBitstringStatusList');
    });

    cy.wait('@issueCredentials').then((interception) => {
      const credential = interception.request.body.credential;
      cy.log('interception: request: ', JSON.stringify(credential));
      expect(interception?.response?.statusCode).to.eq(201);
      DIACredential = credential;
    });

    // await API storage VC
    cy.wait('@storeVC').then((interception) => {
      expect(interception?.response?.statusCode).to.eq(201);
      cy.log('Completed: storeVC');

      // Extract the URI from the response
      const { uri, hash } = interception?.response?.body;
      expect(uri).to.not.be.undefined;
      expect(hash).to.not.be.undefined;
      cy.request('GET', uri).then((response) => {
        expect(response.status).to.eq(200);
      });
    });

    // await API register link
    cy.wait('@linkResolverRegister').then((interception) => {
      expect(interception?.response?.statusCode).to.eq(201);
      cy.log('Completed: linkResolverRegister');
    });

    // Verify toast appears, using react-toastify
    cy.get('.Toastify__toast').should('be.visible').and('contain', 'Action Successful');
  });

  it('Verify linkType', () => {
    const checkLinkTypeURL = 'http://localhost:3000/gs1/01/09359502000010';
    cy.request('GET', checkLinkTypeURL).then((response) => {
      expect(response.status).to.eq(200);
    });
  });

  it('Runs testing UNTP', () => {
    cy.task('runUntpTest', { type: 'digitalIdentityAnchor', version: 'v0.2.1', testData: DIACredential }).then(
      (result: any) => {
        cy.log('UNTP test result: ', result);
        expect(result).to.not.be.undefined;
        expect(result).to.not.be.null;
        expect(result.result).to.eq('WARN');
      },
    );
  });
});
