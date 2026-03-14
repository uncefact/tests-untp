import type { OrganisationEntity } from '../types.js';
import { buildIdentifierScheme, type IdentifierScheme } from './identifier.js';

export type Party = {
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: IdentifierScheme;
};

export function buildParty(org: OrganisationEntity | undefined): Party {
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
