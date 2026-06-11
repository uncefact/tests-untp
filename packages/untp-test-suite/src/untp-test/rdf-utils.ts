// import { QueryEngine } from '@comunica/query-sparql';
import chalk from 'chalk';
import * as querySparql from '@comunica/query-sparql';
import n3 from 'n3';
import * as n3Utils from './n3-utils';

// Interfaces for product claim criteria
interface Criterion {
  id: string;
  name: string;
  verifiedBy?: string;
  verifierName?: string;
}

interface Claim {
  id: string;
  topic: string;
  conformance: string;
  criteria: Criterion[];
  verified?: boolean;
}

interface Product {
  id: string;
  name: string;
  claims: Claim[];
  dppId: string; // ID of the Digital Product Passport this product belongs to
}

/**
 * Extracts all products with claims and criteria from the RDF graph using SPARQL querying
 * including verification information from inferences
 * @param n3store - The N3 Store containing the RDF graph
 * @returns Promise with an array of Product objects containing claims and criteria with verification info
 */
export async function listAllProducts(n3store: n3.Store): Promise<Product[]> {
  try {
    // Create a query engine
    const mySparqlEngine = new querySparql.QueryEngine();

    // Create maps for organizing the data
    const productsMap = new Map<string, Product>();
    const claimsMap = new Map<string, Claim>();

    // UNTP has two context schemes that expand to different RDF shapes:
    //  - 0.6.x: per-type vocabulary (test.uncefact.org/vocabulary/untp/{dpp,core}/0/),
    //    with an intermediate `untp:product` node and `conformityClaim` /
    //    `assessmentCriteria` predicates.
    //  - 0.7.0+: a single unified vocabulary (vocabulary.uncefact.org/untp/), where the
    //    `credentialSubject` IS the Product and claims use `performanceClaim` /
    //    `referenceCriteria`.
    // Query both shapes (version-aware) so a graph in either version yields products.
    const criteriaQueries = [
      // 0.6.x scheme
      `
      PREFIX dpp: <https://test.uncefact.org/vocabulary/untp/dpp/0/>
      PREFIX schemaorg: <https://schema.org/>
      PREFIX untp: <https://test.uncefact.org/vocabulary/untp/core/0/>
      PREFIX vc: <https://www.w3.org/2018/credentials#>
      PREFIX result: <http://example.org/result#>

      SELECT ?credential ?product ?productName ?claim ?topic ?conformance ?criterion ?criterionName
             (EXISTS { ?claim result:allCriteriaVerified true } AS ?claimVerified)
             (EXISTS { ?claim result:verifiedCriterion ?criterion } AS ?criterionVerified)
      WHERE {
        ?credential a dpp:DigitalProductPassport .
        ?credential vc:credentialSubject ?subject .
        ?subject untp:product ?product .
        ?product schemaorg:name ?productName .

        # Find conformity claims
        ?subject untp:conformityClaim ?claim .
        ?claim untp:conformityTopic ?topic .
        ?claim untp:conformance ?conformance .

        # Get criteria if they exist
        ?claim untp:assessmentCriteria ?criterion .
        ?criterion schemaorg:name ?criterionName .
      }
    `,
      // 0.7.0+ unified scheme
      `
      PREFIX untp: <https://vocabulary.uncefact.org/untp/>
      PREFIX schemaorg: <https://schema.org/>
      PREFIX vc: <https://www.w3.org/2018/credentials#>
      PREFIX result: <http://example.org/result#>

      SELECT ?credential ?product ?productName ?claim ?topic ?criterion ?criterionName
             (EXISTS { ?claim result:allCriteriaVerified true } AS ?claimVerified)
             (EXISTS { ?claim result:verifiedCriterion ?criterion } AS ?criterionVerified)
      WHERE {
        ?credential a untp:DigitalProductPassport .
        ?credential vc:credentialSubject ?product .
        ?product a untp:Product .
        ?product schemaorg:name ?productName .

        # Find performance claims (the 0.7.0 equivalent of conformityClaim).
        # Note: 0.7.0 has no boolean conformance predicate on the claim
        # (verified against the RDF expansion of real 0.7.0 DPPs), so it is not selected.
        ?product untp:performanceClaim ?claim .
        ?claim untp:conformityTopic ?topic .

        # Get reference criteria (the 0.7.0 equivalent of assessmentCriteria)
        ?claim untp:referenceCriteria ?criterion .
        ?criterion schemaorg:name ?criterionName .
      }
    `,
    ];

    // Process one criteria binding into the products/claims maps.
    const processCriteriaBinding = (binding: any) => {
      const dppId = binding.get('credential')?.value || '';
      const productId = binding.get('product')?.value || '';
      const productName = binding.get('productName')?.value || '';
      const claimId = binding.get('claim')?.value || '';
      const topic = binding.get('topic')?.value || '';
      const conformance = binding.get('conformance')?.value || '';
      const criterionId = binding.get('criterion')?.value || '';
      const criterionName = binding.get('criterionName')?.value || '';
      const claimVerified = binding.get('claimVerified')?.value === 'true';
      const criterionVerified = binding.get('criterionVerified')?.value === 'true';

      // Create or get the product
      if (!productsMap.has(productId)) {
        productsMap.set(productId, {
          id: productId,
          name: productName,
          claims: [],
          dppId: dppId,
        });
      }

      // Create or get the claim
      const claimKey = `${productId}-${claimId}`;
      if (!claimsMap.has(claimKey)) {
        const claim: Claim = {
          id: claimId,
          topic: topic,
          conformance: conformance,
          criteria: [],
          verified: claimVerified,
        };
        claimsMap.set(claimKey, claim);
        productsMap.get(productId)!.claims.push(claim);
      } else if (claimVerified) {
        // Update verification status if this binding indicates the claim is verified
        claimsMap.get(claimKey)!.verified = true;
      }

      // Add the criterion to the claim if it doesn't already exist
      const claim = claimsMap.get(claimKey)!;
      if (!claim.criteria.some((c) => c.id === criterionId)) {
        const criterion: Criterion = {
          id: criterionId,
          name: criterionName,
          verifiedBy: criterionVerified ? 'verified' : undefined,
        };
        claim.criteria.push(criterion);
      }
    };

    // Execute the version-aware criteria queries and process their bindings.
    for (const criteriaQuery of criteriaQueries) {
      const result = await mySparqlEngine.queryBindings(criteriaQuery, { sources: [n3store] });
      for await (const binding of result) {
        processCriteriaBinding(binding);
      }
    }

    // Get verifier information for verified criteria
    const verifierResult = await mySparqlEngine.queryBindings(
      `
      PREFIX dcc: <https://test.uncefact.org/vocabulary/untp/dcc/0/>
      PREFIX result: <http://example.org/result#>
      PREFIX schemaorg: <https://schema.org/>
      PREFIX vc: <https://www.w3.org/2018/credentials#>

      SELECT ?criterion ?verifierId ?verifierName
      WHERE {
        ?claim result:verifiedCriterion ?criterion .
        ?claim result:dependsOn ?dccCredential .
        ?dccCredential vc:issuer ?verifierId .
        ?verifierId schemaorg:name ?verifierName .
      }
    `,
      {
        sources: [n3store],
      },
    );

    // Add verifier information to criteria
    for await (const binding of verifierResult) {
      const criterionId = binding.get('criterion')?.value || '';
      const verifierId = binding.get('verifierId')?.value || '';
      const verifierName = binding.get('verifierName')?.value || '';

      // Find this criterion in all claims
      for (const claim of claimsMap.values()) {
        const criterion = claim.criteria.find((c) => c.id === criterionId);
        if (criterion) {
          criterion.verifiedBy = verifierId;
          criterion.verifierName = verifierName;
        }
      }
    }

    // Get simple claims (claims without criteria), version-aware across both
    // the 0.6.x per-type scheme and the 0.7.0+ unified scheme.
    const simpleClaimsQueries = [
      // 0.6.x scheme
      `
      PREFIX dpp: <https://test.uncefact.org/vocabulary/untp/dpp/0/>
      PREFIX schemaorg: <https://schema.org/>
      PREFIX untp: <https://test.uncefact.org/vocabulary/untp/core/0/>
      PREFIX vc: <https://www.w3.org/2018/credentials#>
      PREFIX result: <http://example.org/result#>

      SELECT ?credential ?product ?productName ?claim ?topic ?conformance
             (EXISTS { ?claim result:allCriteriaVerified true } AS ?claimVerified)
      WHERE {
        ?credential a dpp:DigitalProductPassport .
        ?credential vc:credentialSubject ?subject .
        ?subject untp:product ?product .
        ?product schemaorg:name ?productName .

        # Find conformity claims
        ?subject untp:conformityClaim ?claim .
        ?claim untp:conformityTopic ?topic .
        ?claim untp:conformance ?conformance .

        # Ensure this is a simple claim (no criteria)
        FILTER NOT EXISTS { ?claim untp:assessmentCriteria ?criterion }
      }
    `,
      // 0.7.0+ unified scheme
      `
      PREFIX untp: <https://vocabulary.uncefact.org/untp/>
      PREFIX schemaorg: <https://schema.org/>
      PREFIX vc: <https://www.w3.org/2018/credentials#>
      PREFIX result: <http://example.org/result#>

      SELECT ?credential ?product ?productName ?claim ?topic
             (EXISTS { ?claim result:allCriteriaVerified true } AS ?claimVerified)
      WHERE {
        ?credential a untp:DigitalProductPassport .
        ?credential vc:credentialSubject ?product .
        ?product a untp:Product .
        ?product schemaorg:name ?productName .

        # Find performance claims (0.7.0 has no boolean conformance predicate on
        # the claim, so it is not selected).
        ?product untp:performanceClaim ?claim .
        ?claim untp:conformityTopic ?topic .

        # Ensure this is a simple claim (no reference criteria)
        FILTER NOT EXISTS { ?claim untp:referenceCriteria ?criterion }
      }
    `,
    ];

    // Process one simple-claim binding into the products/claims maps.
    const processSimpleClaimBinding = (binding: any) => {
      const dppId = binding.get('credential')?.value || '';
      const productId = binding.get('product')?.value || '';
      const productName = binding.get('productName')?.value || '';
      const claimId = binding.get('claim')?.value || '';
      const topic = binding.get('topic')?.value || '';
      const conformance = binding.get('conformance')?.value || '';
      const claimVerified = binding.get('claimVerified')?.value === 'true';

      // Create or get the product
      if (!productsMap.has(productId)) {
        productsMap.set(productId, {
          id: productId,
          name: productName,
          claims: [],
          dppId: dppId,
        });
      }

      // Create the simple claim
      const claimKey = `${productId}-${claimId}`;
      if (!claimsMap.has(claimKey)) {
        const claim: Claim = {
          id: claimId,
          topic: topic,
          conformance: conformance,
          criteria: [],
          verified: claimVerified,
        };
        claimsMap.set(claimKey, claim);
        productsMap.get(productId)!.claims.push(claim);
      } else if (claimVerified) {
        // Update verification status if this binding indicates the claim is verified
        claimsMap.get(claimKey)!.verified = true;
      }
      console.warn(`Product ${productName}: Found claim ${topic} without any criteria!`);
    };

    // Execute the version-aware simple-claim queries and process their bindings.
    for (const simpleClaimsQuery of simpleClaimsQueries) {
      const simpleClaimsResult = await mySparqlEngine.queryBindings(simpleClaimsQuery, { sources: [n3store] });
      for await (const binding of simpleClaimsResult) {
        processSimpleClaimBinding(binding);
      }
    }

    return Array.from(productsMap.values());
  } catch (error) {
    console.error(`Error listing product claim criteria: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    return [];
  }
}

/**
 * Checks a DPP's dependencies to get a set of verifiable credentials required
 * to support the claims of the product passport, then follows the trust chain
 * from each credential issuer via DigitalIdentityAnchors (if any), returning
 * the issuers of the credentials that are not attested.
 *
 * This function handles nested DIAs (Digital Identity Anchors) that attest to other DIAs,
 * creating a complete trust chain through multiple levels of attestation.
 *
 * @param n3store - The N3 Store containing the RDF graph
 * @param dppId - The ID of the Digital Product Passport to check
 * @returns Promise with an array of unattested issuer IDs
 * @throws Error if the query fails.
 */
export async function getUnattestedIssuersForProduct(
  dppId: string,
  n3store: n3.Store,
  trustedDIDs: string[] = [],
): Promise<string[]> {
  try {
    // Create a query engine
    const mySparqlEngine = new querySparql.QueryEngine();

    // Query for all Conformity Credentials that attest to claims in the DPP
    const dccList = await mySparqlEngine.queryBindings(
      `
      PREFIX result: <http://example.org/result#>

      SELECT ?dcc
      WHERE {
        <${dppId}> result:claimsAttestedBy ?dcc .
      }
    `,
      {
        sources: [n3store],
      },
    );

    // Collect all credential IDs including the DPP itself
    const credentialIds: string[] = [dppId];

    // Add all credentials that attest to claims in the DPP
    for await (const binding of dccList) {
      const dccId = binding.get('dcc')?.value;
      if (dccId && !credentialIds.includes(dccId)) {
        credentialIds.push(dccId);
      }
    }

    // credentialIds now contains all credentials that are relevant to the DPP,
    // for which we need to ensure we trust the issuers.

    // Use a SPARQL path query to find all identity attestation chains
    const attestationResult = await mySparqlEngine.queryBindings(
      `
      PREFIX result: <http://example.org/result#>

      SELECT ?credential ?dia
      WHERE {
        # Find all DIAs in the attestation chain using property path
        ?credential result:issuerIdentityAttestedBy ?dia .
      }
    `,
      {
        sources: [n3store],
      },
    );

    // Log the attestation chains for debugging
    // console.log('Attestation chains:');
    const attestationChains: Record<string, string[]> = {};
    const attestedCredentials = new Set<string>();
    const allCredentials = new Set<string>(credentialIds);

    for await (const binding of attestationResult) {
      const credential = binding.get('credential')?.value || '';
      const dia = binding.get('dia')?.value || '';

      if (!attestationChains[credential]) {
        attestationChains[credential] = [];
      }

      attestationChains[credential].push(dia);
      // console.log(`Credential ${credential} is attested by DIA ${dia}`);

      // Mark this credential as attested
      attestedCredentials.add(credential);

      // Add the DIA to our list of all credentials
      allCredentials.add(dia);
    }

    // Find credentials without attestations
    const unattestatedCredentials = Array.from(allCredentials).filter((id) => !attestedCredentials.has(id));

    if (unattestatedCredentials.length === 0) {
      return [];
    }

    // Get the issuers of these unattested credentials
    const unattestatedIssuersQuery = await mySparqlEngine.queryBindings(
      `
      PREFIX vc: <https://www.w3.org/2018/credentials#>

      SELECT DISTINCT ?issuer
      WHERE {
        # Filter to only include our unattested credentials
        VALUES ?credential { ${unattestatedCredentials.map((id) => `<${id}>`).join(' ')} }

        # Get the issuer for each credential
        ?credential vc:issuer ?issuer .
      }
    `,
      {
        sources: [n3store],
      },
    );

    // Collect the unattested issuers
    let unattestedIssuers: string[] = [];
    for await (const binding of unattestatedIssuersQuery) {
      const issuer = binding.get('issuer')?.value;
      if (issuer) {
        unattestedIssuers.push(issuer);
      }
    }

    unattestedIssuers = unattestedIssuers.filter((issuer) => !trustedDIDs.includes(issuer));

    return unattestedIssuers;
  } catch (error) {
    console.error(`Error getting attested credentials: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
