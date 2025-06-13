Cypress.Commands.add('verifyAppConfig', () => {
  const AppConfig = Cypress.env('AppConfig');
  expect(AppConfig?.name).to.not.be.null;
  expect(AppConfig?.name).to.not.be.undefined;
  expect(AppConfig?.name).to.eq('UNTP Reference Implementation');
});

Cypress.Commands.add(
  'generateWorkflow',
  (page, workflowName, schemaName, configPath, successMessage = 'Action Successful') => {
    const AppConfig = Cypress.env('AppConfig');

    cy.visit('/');

    cy.navigateTo(page);

    const feature = AppConfig[configPath][0]?.features.find(
      (feature: { name: string }) => feature.name === workflowName,
    );

    const components = feature?.components?.[0]?.props;
    const urlWithoutStorage = components?.schema?.url || '';
    const urlWithStorage = components?.nestedComponents?.[0]?.props?.schema?.url || '';
    const schemaURL = urlWithoutStorage || urlWithStorage || '';

    if (schemaURL) {
      cy.interceptAPI('GET', schemaURL, `get${schemaName}`);

      // Wait for the API response, then render the page
      cy.navigateTo(workflowName);

      cy.waitForAPIResponse(`get${schemaName}`, 200);
    } else {
      cy.navigateTo(workflowName);
    }

    const findProcessService = feature?.services?.find((service: any) => service.name.includes('process'))
      ?.parameters?.[0];
    const appService = findProcessService ?? {};

    const API_ENDPOINT = {
      ISSUE_BITSTRING_STATUS_LIST: '/agent/issueBitstringStatusList',
      VCKit_URL: appService?.vckit?.vckitAPIUrl + '/credentials/issue',
      STORAGE_URL: appService?.storage?.url,
      IDR_URL: appService?.dlr?.dlrAPIUrl + appService?.dlr?.linkRegisterPath,
    };

    cy.interceptAPI('POST', API_ENDPOINT.ISSUE_BITSTRING_STATUS_LIST, 'issueBitStringStatusList');
    cy.interceptAPI('POST', API_ENDPOINT.VCKit_URL, 'issueCredentials');
    cy.interceptAPI('POST', API_ENDPOINT.STORAGE_URL, 'storeVC');
    cy.interceptAPI('POST', API_ENDPOINT.IDR_URL, 'linkResolverRegister');

    cy.contains('button', 'Submit').should('be.visible').and('not.be.disabled').click();

    // Await API responses
    cy.waitForAPIResponse('issueBitStringStatusList', 200).then(() => {
      cy.log(`Completed: issueBitstringStatusList for ${workflowName}`);
    });

    cy.waitForAPIResponse('issueCredentials', 201).then((interception: any) => {
      const credential = interception.request.body.credential;
      cy.log('interception: request: ', JSON.stringify(credential));
      Cypress.env('lastCredential', credential);
    });

    cy.waitForAPIResponse('storeVC', 201).then((interception: any) => {
      cy.log(`Completed: storeVC for ${workflowName}`);
      const { uri, hash } = interception?.response?.body;
      expect(uri).to.not.be.undefined;
      expect(hash).to.not.be.undefined;
      cy.request('GET', uri).then((response) => {
        expect(response.status).to.eq(200);
      });
    });

    cy.waitForAPIResponse('linkResolverRegister', 201).then(() => {
      cy.log(`Completed: linkResolverRegister for ${workflowName}`);
    });

    cy.verifySuccessToast(successMessage);
  },
);

Cypress.Commands.add('runUntpTest', (type: string, version: string, testData: any, expectResult?: string) => {
  cy.task('runUntpTest', { type, version, testData }).then((result: any) => {
    expect(result).to.not.be.undefined;
    expect(result).to.not.be.null;

    if (expectResult) {
      expect(result.result).to.eq(expectResult);
    } else {
      expect(result.result).to.eq('PASS');
    }
  });
});
