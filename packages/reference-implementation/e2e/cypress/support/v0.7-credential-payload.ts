export type V070CredentialPayloadOptions = {
  templateDir: string;
  credentialId: string;
  credentialName?: string;
  issuerDid: string;
  validFrom: string;
  validUntil: string;
};

/** Reads a canonical v0.7.0 example and applies the fields owned by the test run. */
export function readV070CredentialPayload(
  options: V070CredentialPayloadOptions,
): Cypress.Chainable<Record<string, any>> {
  return cy.readFile(`../src/templates/v0.7.0/${options.templateDir}/example-data.json`).then((source) => {
    const credentialPayload = JSON.parse(JSON.stringify(source)) as Record<string, any>;
    credentialPayload.id = options.credentialId;
    if (options.credentialName !== undefined) credentialPayload.name = options.credentialName;
    credentialPayload.issuer.id = options.issuerDid;
    credentialPayload.validFrom = options.validFrom;
    credentialPayload.validUntil = options.validUntil;
    return credentialPayload;
  });
}
