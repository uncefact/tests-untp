import type { ExtractedRefs } from '@uncefact/untp-ri-services';
import { findIdentifiersByValue } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'resolve-publish-target' });

/**
 * Everything the IDR publish call needs, read from the identifier rather than
 * from a matched master-data record (ADR-043). The scheme, registrar and IDR
 * service instance all hang off `Identifier`, so an entity is not required for
 * a credential to be discoverable.
 */
export type PublishTarget = {
  identifierValue: string;
  schemePrimaryKey: string;
  schemeNamespace: string;
  schemeIdrServiceInstanceId: string | null;
  registrarIdrServiceInstanceId: string | null;
};

export type ResolvePublishTargetResult =
  | { outcome: 'resolved'; target: PublishTarget }
  | { outcome: 'no-reference' }
  | { outcome: 'not-found'; value: string }
  | { outcome: 'incomplete'; value: string }
  | { outcome: 'ambiguous'; value: string; candidates: { schemeId: string; schemeName: string }[] }
  | { outcome: 'unavailable' };

/**
 * Chooses the reference the credential is published under: product, then
 * facility, then organisation, without falling through to another type when
 * the chosen one does not resolve. Publishing a credential under a different
 * subject than the payload leads with would be a silent substitution, and no
 * warning makes that safe (ADR-043).
 */
function chooseReference(refs: ExtractedRefs): { id: string } | undefined {
  return refs.products[0] ?? refs.facilities[0] ?? refs.organisations[0];
}

/**
 * Resolves the publish target from the credential's own references.
 *
 * The value is looked up across the tenant's schemes, and a value matching
 * more than one scheme is reported rather than guessed: identifier values are
 * unique only within a scheme. A caller disambiguates by naming the scheme in
 * `publishingOptions.identifierSchemeId`.
 */
export async function resolvePublishTarget(
  refs: ExtractedRefs,
  tenantId: string,
  identifierSchemeId?: string,
): Promise<ResolvePublishTargetResult> {
  const reference = chooseReference(refs);
  if (!reference?.id) return { outcome: 'no-reference' };

  const matches = await findIdentifiersByValue(reference.id, tenantId, identifierSchemeId);

  if (matches.length === 0) {
    logger.warn({ tenantId, value: reference.id }, 'No identifier matches the credential reference');
    return { outcome: 'not-found', value: reference.id };
  }

  if (matches.length > 1) {
    // The caller needs the scheme ids, not just their names: naming the option
    // without its value leaves them unable to act on the warning.
    const candidates = matches.map((match) => ({ schemeId: match.schemeId, schemeName: match.scheme.name }));
    logger.warn({ tenantId, value: reference.id, candidates }, 'Credential reference matches more than one scheme');
    return { outcome: 'ambiguous', value: reference.id, candidates };
  }

  const [identifier] = matches;
  const namespace = identifier.scheme.registrar?.namespace;
  if (!identifier.scheme.primaryKey || !namespace) {
    return { outcome: 'incomplete', value: reference.id };
  }

  return {
    outcome: 'resolved',
    target: {
      identifierValue: identifier.value,
      schemePrimaryKey: identifier.scheme.primaryKey,
      schemeNamespace: namespace,
      schemeIdrServiceInstanceId: identifier.scheme.idrServiceInstanceId ?? null,
      registrarIdrServiceInstanceId: identifier.scheme.registrar?.idrServiceInstanceId ?? null,
    },
  };
}
