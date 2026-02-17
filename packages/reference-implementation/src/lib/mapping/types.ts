import { ResolvedEntities, EntityReferences } from '@/lib/services/entity-resolution.service';

export type { ResolvedEntities, EntityReferences };

/**
 * Interface for credential mappers.
 * Each credential type + version has a mapper that builds the credential payload
 * from resolved master data entities.
 */
export interface ICredentialMapper {
  /**
   * Builds the credentialSubject payload from resolved entities.
   * Sets UNTP-specific @context entries, type entries, and credentialSubject fields.
   */
  buildPayload(entities: ResolvedEntities, tenantId: string): Promise<Record<string, unknown>>;

  /**
   * Extracts entity ID references from a credential payload.
   * Used for reverse-mapping (e.g., linking a stored credential back to its entities).
   */
  extractEntityRefs(payload: Record<string, unknown>): EntityReferences;
}
