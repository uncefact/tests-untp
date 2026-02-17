import { ICredentialMapper } from './types';

/**
 * Registry mapping credentialType + version to a mapper instance.
 * Structure: { [credentialType]: { [version]: ICredentialMapper } }
 */
const registry: Record<string, Record<string, ICredentialMapper>> = {};

/**
 * Registers a mapper for a given credential type and version.
 */
export function registerMapper(credentialType: string, version: string, mapper: ICredentialMapper): void {
  if (!registry[credentialType]) {
    registry[credentialType] = {};
  }
  registry[credentialType][version] = mapper;
}

/**
 * Retrieves the mapper for a given credential type and version.
 * Returns undefined if no mapper is registered.
 */
export function getMapper(credentialType: string, version: string): ICredentialMapper | undefined {
  return registry[credentialType]?.[version];
}

/**
 * Returns all registered credential type + version combinations.
 * Useful for diagnostics and listing supported types.
 */
export function listRegisteredMappers(): Array<{
  credentialType: string;
  version: string;
}> {
  const result: Array<{ credentialType: string; version: string }> = [];
  for (const [credentialType, versions] of Object.entries(registry)) {
    for (const version of Object.keys(versions)) {
      result.push({ credentialType, version });
    }
  }
  return result;
}

/** @internal -- for testing only */
export function clearRegistry(): void {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
}
