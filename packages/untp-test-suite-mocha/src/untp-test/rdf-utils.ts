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
  dppId: string;  // ID of the Digital Product Passport this product belongs to
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

    // Execute a SPARQL query directly on the n3store to get products, claims, and criteria
    const result = await mySparqlEngine.queryBindings(`
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
        ?claim untp:Criterion ?criterion .
        ?criterion schemaorg:name ?criterionName .
      }
    `, {
      sources: [n3store]
    });

    // Create maps for organizing the data
    const productsMap = new Map<string, Product>();
    const claimsMap = new Map<string, Claim>();

    // Process each binding (row of results) using async iteration
    for await (const binding of result) {
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
          dppId: dppId
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
          verified: claimVerified
        };
        claimsMap.set(claimKey, claim);
        productsMap.get(productId)!.claims.push(claim);
      } else if (claimVerified) {
        // Update verification status if this binding indicates the claim is verified
        claimsMap.get(claimKey)!.verified = true;
      }

      // Add the criterion to the claim if it doesn't already exist
      const claim = claimsMap.get(claimKey)!;
      if (!claim.criteria.some(c => c.id === criterionId)) {
        const criterion: Criterion = {
          id: criterionId,
          name: criterionName,
          verifiedBy: criterionVerified ? 'verified' : undefined
        };
        claim.criteria.push(criterion);
      }
    }


    // Get verifier information for verified criteria
    const verifierResult = await mySparqlEngine.queryBindings(`
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
    `, {
      sources: [n3store]
    });

    // Add verifier information to criteria
    for await (const binding of verifierResult) {
      const criterionId = binding.get('criterion')?.value || '';
      const verifierId = binding.get('verifierId')?.value || '';
      const verifierName = binding.get('verifierName')?.value || '';

      // Find this criterion in all claims
      for (const claim of claimsMap.values()) {
        const criterion = claim.criteria.find(c => c.id === criterionId);
        if (criterion) {
          criterion.verifiedBy = verifierId;
          criterion.verifierName = verifierName;
        }
      }
    }

    // Get simple claims (claims without criteria)
    const simpleClaimsResult = await mySparqlEngine.queryBindings(`
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
        FILTER NOT EXISTS { ?claim untp:Criterion ?criterion }
      }
    `, {
      sources: [n3store]
    });

    // Process simple claims
    for await (const binding of simpleClaimsResult) {
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
          dppId: dppId
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
          verified: claimVerified
        };
        claimsMap.set(claimKey, claim);
        productsMap.get(productId)!.claims.push(claim);
      } else if (claimVerified) {
        // Update verification status if this binding indicates the claim is verified
        claimsMap.get(claimKey)!.verified = true;
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

    // Query for all credentials that attest to claims in the DPP
    const result = await mySparqlEngine.queryBindings(`
      PREFIX result: <http://example.org/result#>

      SELECT ?credential
      WHERE {
        <${dppId}> result:claimsAttestedBy ?credential .
      }
    `, {
      sources: [n3store]
    });

    // Collect all credential IDs including the DPP itself
    const credentialIds: string[] = [dppId];

    // Add all credentials that attest to claims in the DPP
    for await (const binding of result) {
      const credentialId = binding.get('credential')?.value;
      if (credentialId && !credentialIds.includes(credentialId)) {
        credentialIds.push(credentialId);
      }
    }

    // credentialIds now contains all credentials that are relevant to the DPP,
    // for which we need to ensure we trust the issuers.


    // Use a SPARQL path query to find all identity attestation chains
    const attestationResult = await mySparqlEngine.queryBindings(`
      PREFIX result: <http://example.org/result#>

      SELECT ?credential ?dia
      WHERE {
        # Find all DIAs in the attestation chain using property path
        ?credential result:issuerIdentityAttestedBy ?dia .
      }
    `, {
      sources: [n3store]
    });

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
    const unattestatedCredentials = Array.from(allCredentials).filter(id => !attestedCredentials.has(id));

    if (unattestatedCredentials.length === 0) {
      return [];
    }

    // Get the issuers of these unattested credentials
    const unattestatedIssuersQuery = await mySparqlEngine.queryBindings(`
      PREFIX vc: <https://www.w3.org/2018/credentials#>

      SELECT DISTINCT ?issuer
      WHERE {
        # Filter to only include our unattested credentials
        VALUES ?credential { ${unattestatedCredentials.map(id => `<${id}>`).join(' ')} }

        # Get the issuer for each credential
        ?credential vc:issuer ?issuer .
      }
    `, {
      sources: [n3store]
    });

    // Collect the unattested issuers
    let unattestedIssuers: string[] = [];
    for await (const binding of unattestatedIssuersQuery) {
      const issuer = binding.get('issuer')?.value;
      if (issuer) {
        unattestedIssuers.push(issuer);
      }
    }

    unattestedIssuers = unattestedIssuers.filter(issuer => !trustedDIDs.includes(issuer));

    return unattestedIssuers;
  } catch (error) {
    console.error(`Error getting attested credentials: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

