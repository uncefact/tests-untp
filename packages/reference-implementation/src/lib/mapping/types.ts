import { DataModelWithRelations } from '@/lib/prisma/repositories';
import { ResolvedEntities, EntityReferences } from '@/lib/services/entity-resolution.service';
import type { CredentialSubject } from '@uncefact/untp-ri-services';

export type { ResolvedEntities, EntityReferences };

/**
 * Data model configuration for credential payload building.
 * Contains the core data model and an optional extension.
 */
export type DataModelConfig = {
  core: DataModelWithRelations;
  extension?: DataModelWithRelations;
};

/**
 * Output from a credential mapper's buildPayload method.
 * Contains the @context, type, and credentialSubject — the parts
 * that the mapper is responsible for. The issuer, status, and
 * renderMethod are added downstream by the VC service.
 */
export type MapperOutput = {
  '@context': string[];
  type: string[];
  credentialSubject: CredentialSubject;
};

/**
 * Identifier references extracted from a credential payload.
 * Contains registered IDs and qualifiers needed to find entities
 * in the database given a credential payload.
 */
export type ExtractedIdentifierRefs = {
  product?: { registeredId: string; batchNumber?: string; serialNumber?: string };
  organisation?: { registeredId: string };
  facility?: { registeredId: string };
};

/**
 * Interface for credential mappers.
 * Each credential type + version has a mapper that builds the credential payload
 * from resolved master data entities.
 */
export interface ICredentialMapper {
  /**
   * Builds the credential payload from resolved entities.
   * Uses the data model config for @context and type values.
   */
  buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput>;

  /**
   * Extracts identifier references from a credential payload.
   * Returns registered IDs and qualifiers for each entity, used to
   * associate a stored credential back to its database entities.
   */
  extractEntityRefs(payload: MapperOutput): ExtractedIdentifierRefs;
}
