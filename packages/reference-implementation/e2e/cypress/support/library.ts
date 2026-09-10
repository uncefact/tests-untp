/**
 * Poll a library record until the requested verification generation settles.
 * An older generation, or a pending state from any generation, is not a
 * successful result.
 */
export function waitForGeneration(
  id: string,
  token: string,
  generation: number,
  timeoutMs = 90_000,
): Cypress.Chainable<Record<string, any>> {
  const startedAt = Date.now();

  const poll = (): Cypress.Chainable<Record<string, any>> =>
    cy
      .request({
        method: 'GET',
        url: `/api/v1/library/${id}`,
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        const body = response.body as Record<string, any>;
        const verification = body.verification as Record<string, any> | undefined;

        if (verification?.state === 'failed') {
          throw new Error(
            `Library verification generation ${verification.generation} failed for ${id}: ${JSON.stringify(
              verification.failure,
            )}`,
          );
        }

        if (verification?.generation === generation && verification.state !== 'pending') {
          return body;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error(
            `Timed out waiting for library record ${id} generation ${generation}; last response: ${JSON.stringify(
              body,
            )}`,
          );
        }

        return cy.wait(2_000).then(poll);
      });

  return poll();
}
