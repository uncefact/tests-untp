import type { ICredentialMapper } from './types.js';

const registry: Record<string, Record<string, ICredentialMapper>> = {};

export function registerMapper(credentialType: string, version: string, mapper: ICredentialMapper): void {
  if (!registry[credentialType]) {
    registry[credentialType] = {};
  }
  registry[credentialType][version] = mapper;
}

export function getMapper(credentialType: string, version: string): ICredentialMapper | undefined {
  return registry[credentialType]?.[version];
}

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
