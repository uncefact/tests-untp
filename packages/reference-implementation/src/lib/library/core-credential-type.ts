// Relative import (not the @/ alias): this module is copied into the Docker
// image for the details backfill, where no tsconfig.json resolves aliases.
import { CoreCredentialType } from '../prisma/generated';

/**
 * The UNTP core credential types under their two names: the code the API
 * uses (and the library stores) and the full name the data-model bridge
 * registry is keyed by. One map, both directions, so a type can never be
 * spelt two ways in one place.
 */
const BRIDGE_NAME_BY_CODE: Record<CoreCredentialType, string> = {
  [CoreCredentialType.DPP]: 'DigitalProductPassport',
  [CoreCredentialType.DCC]: 'DigitalConformityCredential',
  [CoreCredentialType.DFR]: 'DigitalFacilityRecord',
  [CoreCredentialType.DTE]: 'DigitalTraceabilityEvent',
  [CoreCredentialType.DIA]: 'DigitalIdentityAnchor',
};

const CODE_BY_BRIDGE_NAME = new Map<string, CoreCredentialType>(
  (Object.entries(BRIDGE_NAME_BY_CODE) as [CoreCredentialType, string][]).map(([code, name]) => [name, code]),
);

/** The bridge registry's key for a core credential type. */
export function bridgeNameOf(type: CoreCredentialType): string {
  return BRIDGE_NAME_BY_CODE[type];
}

/** The core credential type a bridge registry key names, or undefined for any other string. */
export function coreCredentialTypeOf(bridgeName: string): CoreCredentialType | undefined {
  return CODE_BY_BRIDGE_NAME.get(bridgeName);
}

/**
 * The core credential type a credential's `type` array names, read as a set
 * (ADR-053 decision 8): the one distinct core name it contains. 'none' when
 * it names no core type, so a caller may look elsewhere. 'ambiguous' when it
 * names two or more different ones, which is an error a caller must record
 * rather than resolve, because no bridge can then be chosen.
 */
export function coreCredentialTypeFromTypes(types: unknown): CoreCredentialType | 'none' | 'ambiguous' {
  const list = Array.isArray(types) ? types : [types];
  const named = new Set<CoreCredentialType>();
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const code = coreCredentialTypeOf(entry);
    if (code !== undefined) named.add(code);
  }
  if (named.size === 0) return 'none';
  return named.size === 1 ? [...named][0] : 'ambiguous';
}
