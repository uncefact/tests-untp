import { buildDccSubject as buildDccSubjectV060 } from '../v060/builder.js';
import type { BridgeEntities, CredentialSubject } from '../../../../types.js';

/**
 * DCC v0.6.1 builder — delegates to the v0.6.0 builder then replaces the scope
 * with the v0.6.1 ConformityScheme shape (was ConformityAssessmentScheme in v0.6.0).
 *
 * v0.6.1 scope fields that cannot yet be populated from BridgeEntities
 * (description, version, validFrom, owner) are omitted — the bridge populates
 * what it can from the available ConformityInput.scheme data.
 */
export function buildDccSubjectV061(entities: BridgeEntities): CredentialSubject {
  const subject = buildDccSubjectV060(entities);

  // Replace the v0.6.0 scope with the v0.6.1 ConformityScheme shape
  const firstScheme = entities.conformity?.[0]?.scheme;
  if (firstScheme?.id) {
    subject.scope = {
      type: ['ConformityScheme'],
      id: firstScheme.id,
      ...(firstScheme.name && { name: firstScheme.name }),
    };
  }

  return subject;
}
