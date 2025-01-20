describe('Issue DFR end-to-end testing flow', () => {
  beforeEach(() => {
    // Load app config JSON
    cy.fixture('app-config.json').then((data) => {
      Cypress.env('AppConfig', data);
    });
  });

  it('should access the right the app config data', () => {
    const AppConfig = Cypress.env('AppConfig');
    expect(AppConfig?.name).to.eq('CHERRIES SUPPLY CHAIN TRACEABILITY');
  });

  it('should visit the homepage, navigate to "General features", handle API calls, and show success message', () => {
    const AppConfig = Cypress.env('AppConfig');
    cy.visit('/');

    cy.contains('a', 'General features').should('be.visible').and('not.be.disabled').click();

    cy.url().should('include', '/general-features');
    // temporary hardcoding the schema URL and app service
    const shemaDFR = AppConfig.generalFeatures[0]?.features[0]?.components[0].props?.schema?.url;
    const appService = AppConfig.generalFeatures[0]?.features[0]?.services[0]?.parameters[0];
    cy.intercept('GET', shemaDFR).as('getFacilitySchema');

    cy.contains('a', 'Generate DFR') // Find button by text
      .should('be.visible')
      .and('not.be.disabled')
      .click();

    // Wait for the API call
    cy.wait('@getFacilitySchema', { timeout: 20000 }).then((interception) => {
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

    // Check if "Submit" button appears after API response
    cy.contains('button', 'Submit').should('be.visible').and('not.be.disabled').click();

    // await API create credential status
    cy.wait('@issueBitStringStatusList').then((interception) => {
      expect(interception?.response?.statusCode).to.eq(200);
      cy.log('Completed: issueBitstringStatusList');
    });

    // await API issue VC
    cy.wait('@issueCredentials').then((interception) => {
      const credential = interception.request.body.credential;
      cy.log('interception: request: ', JSON.stringify(interception.request.body.credential));
      expect(interception?.response?.statusCode).to.eq(201);
      // Write the credential to a file
      cy.task('writeToFile', { fileName: 'DigitalFacilityRecord_instance-v0.5.0.json', data: credential });
      cy.log('Completed: issueCredentials and written to file');
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
    const checkLinkTypeURL = 'http://localhost:3000/gs1/gln/9359502000034';
    cy.request('GET', checkLinkTypeURL).then((response) => {
      expect(response.status).to.eq(200);
    });
  });

  it('Runs testing UNTP V0.5.0', () => {
    cy.exec('pwd').then((result) => {
      cy.log('Current directory:', result.stdout);
    });
    cy.task('runShellScript', { scriptPath: './cypress/e2e/issue_workflow_test/DFR/test-untp-dfr-scripts.sh' }).then(
      (output: any) => {
        const cleanedOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
        cy.log('Shell Script Output:', cleanedOutput);
        // Expect the output to include success message
        expect(cleanedOutput).to.include('Script completed successfully!');
        expect(cleanedOutput).to.include('Testing Credential: digitalFacilityRecord');
        expect(cleanedOutput).to.include('Result: PASS');
      },
    );
  });
});
