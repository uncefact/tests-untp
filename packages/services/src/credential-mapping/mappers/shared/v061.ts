import type { IdentifierScheme } from '../../../verifiable-credential/types.js';
import type { DataModelConfig, OrganisationEntity } from '../../types.js';

export function buildIdentifierScheme(
  scheme: { id?: string; name?: string } | null | undefined,
): IdentifierScheme | undefined {
  if (!scheme || !scheme.id || !scheme.name) return undefined;
  return {
    type: ['IdentifierScheme'],
    id: scheme.id,
    name: scheme.name,
  };
}

export function buildParty(org: OrganisationEntity | undefined): {
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: IdentifierScheme;
} {
  return {
    id: org?.id,
    name: org?.name,
    ...(org?.description && { description: org.description }),
    ...(org?.primaryIdentifier && {
      registeredId: org.primaryIdentifier.value,
      idScheme: buildIdentifierScheme(org.primaryIdentifier.scheme),
    }),
  };
}

export function buildContextAndTypes(config: DataModelConfig): {
  contexts: string[];
  types: string[];
} {
  const contexts: string[] = [config.core.contextUrl];
  const types: string[] = [config.core.credentialType];

  if (config.extension) {
    contexts.push(config.extension.contextUrl);
    if (config.extension.credentialType !== config.core.credentialType) {
      types.push(config.extension.credentialType);
    }
  }

  return { contexts, types };
}
