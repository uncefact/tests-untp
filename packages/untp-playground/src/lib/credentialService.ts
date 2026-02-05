import type { Credential, ExtensionConfig } from '@/types/credential';
import { jwtDecode } from 'jwt-decode';
import { CredentialType, permittedCredentialTypes, shortCredentialTypes } from '../../constants';

export function decodeEnvelopedCredential(credential: any): Credential {
  if (!isEnvelopedProof(credential)) {
    return credential;
  }

  try {
    const jwtPart = credential.id.split(',')[1];
    if (!jwtPart) {
      return credential;
    }

    return jwtDecode(jwtPart);
  } catch (error) {
    console.log('Error processing enveloped credential:', error);
    return credential;
  }
}

export function detectCredentialType(credential: Credential): string {
  const types = [...permittedCredentialTypes, 'DigitalLivestockPassport'];
  return (credential?.type?.find((t) => types.includes(t)) || 'Unknown') as CredentialType;
}

export function detectAllTypes(credential: { type?: string[] }): string[] {
  const validTypes = [...permittedCredentialTypes, 'DigitalLivestockPassport'];
  return credential?.type?.filter((t) => validTypes.includes(t as CredentialType)) || [];
}

export function detectVersion(credential: Credential, domain?: string): string {
  const contextUrl = credential['@context']?.find((ctx) => ctx.includes(domain || 'test.uncefact.org'));

  if (!contextUrl) return 'unknown';

  const versionMatch = contextUrl.match(/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?)/);
  return versionMatch ? versionMatch[1] : 'unknown';
}

export function isEnvelopedProof(credential: any): boolean {
  const normalizedCredential = credential.verifiableCredential || credential;

  return normalizedCredential.type === 'EnvelopedVerifiableCredential';
}

/**
 * Constructs a registry of credential extensions by analyzing type declarations and schema URLs.
 * 
 * Processes a list of credential types and their associated schema URLs to:
 * 1. Extract extension versions and domains from URLs
 * 2. Map extensions to their core credential dependencies
 * 3. Organize into a versioned registry structure
 * 
 * @param {string[]} types - Array of credential types (including both core and extensions)
 * @param {string[]} urls - Array of schema URLs containing version information
 * @returns {Record<string, ExtensionConfig>} Structured registry of extensions with:
 *            - Domain authority
 *            - Versioned schema references
 *            - Associated core credential metadata
 * 
 * @example
 * const registry = constructExtensionRegistry(
 *    ["DigitalLivestockPassport", "DigitalProductPassport", "VerifiableCredential"],
 *   [
 *      "https://www.w3.org/ns/credentials/v2",
 *      "https://test.uncefact.org/vocabulary/untp/dpp/0.6.0-beta9/",
 *      "https://jargon.sh/user/aatp/DigitalLivestockPassport/v/0.4.2-beta1/artefacts/jsonldContexts/DigitalLivestockPassport.jsonld?class=DigitalLivestockPassport"
 *   ]
 * );
 * Returns { DigitalLivestockPassport: { domain: 'jargon.sh', versions: [...] }}
 */
export function constructExtensionRegistry(types: string[], urls: string[]): Record<string, ExtensionConfig> {
  const result: Record<string, ExtensionConfig> = {};

  const coreVersions: Record<string, string> = {};
  urls?.forEach((url) => {
    const coreMatch = url.match(/https:\/\/([^/]+)\/.*\/(dpp|dcc|dte|dfr|dia)\/([^/]+)\//);
    if (coreMatch) {
      const [, domain, shortType, version] = coreMatch;
      const fullType = Object.entries(shortCredentialTypes).find(([, v]) => v === shortType)?.[0] || shortType;
      coreVersions[fullType] = version;
    }
  });

  types?.forEach((type) => {
    if (shortCredentialTypes[type]) return;

    const matchingUrls = urls.filter((url) => url.includes(type));

    matchingUrls?.forEach((url) => {
      const versionMatch = url.match(/v\/([^/]+)/);
      if (!versionMatch) return;

      const domainMatch = url.match(/https:\/\/([^/]+)/);
      if (!domainMatch) return;

      const version = versionMatch[1];
      const domain = domainMatch[1];

      const coreType = Object.keys(coreVersions)[0];
      const coreVersion = coreVersions[coreType];

      if (!result[type]) {
        result[type] = {
          domain,
          versions: [],
        };
      }

      result[type].versions.push({
        version,
        schema: url,
        core: {
          type: coreType,
          version: coreVersion,
        },
      });
    });
  });

  return result;
}
