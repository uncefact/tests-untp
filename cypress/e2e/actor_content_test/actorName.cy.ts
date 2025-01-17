describe('Facility Links Test', () => {
  it('should visit the homepage and verify the facility links', () => {
    // Visit the homepage
    cy.visit('/');
    // Verify the presence of the "CHERRIES SUPPLY CHAIN TRACEABILITY" text
    cy.contains('h5', 'CHERRIES SUPPLY CHAIN TRACEABILITY').should('be.visible');
  });

  it('should verify all <a> tags from the second match the expected texts', () => {
    const expectedTexts = [
      'Orchard Facility',
      'Packhouse Facility',
      'Fumigation and Freight Forwarding Facility',
      'Airport Terminal Facility',
      'Scanning',
      'General features',
    ];

    cy.visit('/');

    cy.get('a').then(($aTags) => {
      expect($aTags.length - 1).to.equal(expectedTexts.length);

      $aTags.each((index, el) => {
        if (index === 0) return;

        cy.wrap(el)
          .invoke('text')
          .then((text) => {
            expect(text.trim()).to.equal(expectedTexts[index - 1]);
          });
      });
    });
  });

  describe('Facility Links Test', () => {
    it('should visit the homepage and click on the "Orchard Facility" link', () => {
      // Visit the homepage
      cy.visit('/');

      // Locate the Orchard Facility link by its href attribute and class
      cy.get('a').eq(1).should('be.visible').and('not.be.disabled').click()

      // Verify the URL to confirm navigation
      cy.url().should('include', '/orchard-facility');
      // Check if the Submit button appears after clicking
      cy.get('a') // Adjust this selector if the button isn't of type submit
        .eq(1)
        .should('be.visible')
        .and('not.be.disabled')
        .click()
    });
  });
});
