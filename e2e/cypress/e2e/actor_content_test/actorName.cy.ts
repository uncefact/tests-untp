describe('Facility Links Test', () => {
  it('should visit the homepage and verify the facility links', () => {
    // Visit the homepage
    cy.visit('/');
    cy.contains('h5', 'UNTP Reference Implementation').should('be.visible');
  });

  it('should verify all <a> tags from the second match the expected texts', () => {
    const expectedTexts = [
      'Example Company',
      'Scanning',
      'General features',
    ];

    cy.visit('/');

    cy.get('a').then(($aTags) => {
      expect($aTags.length).to.equal(expectedTexts.length);

      $aTags.each((index, el) => {
        if (index === 0) return;

        cy.wrap(el)
          .invoke('text')
          .then((text) => {
            expect(text.trim()).to.equal(expectedTexts[index]);
          });
      });
    });
  });

  describe('Facility Links Test', () => {
    it('should visit the homepage and click on the "Example Company" link', () => {
      // Visit the homepage
      cy.visit('/');

      cy.get('a').eq(0).should('be.visible').and('not.be.disabled').click()

      // Verify the URL to confirm navigation
      cy.url().should('include', '/example-company');
      // Check if the Submit button appears after clicking
      cy.get('a') // Adjust this selector if the button isn't of type submit
        .eq(1)
        .should('be.visible')
        .and('not.be.disabled')
        .click()
    });
  });
});
