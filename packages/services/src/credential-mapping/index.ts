// Types
export type {
  ICredentialMapper,
  ICvcAwareMapper,
  MapperOutput,
  ExtractedIdentifierRefs,
  ExtractedCvcRefs,
  DataModelConfig,
  ResolvedEntities,
  OrganisationEntity,
  FacilityEntity,
  ProductEntity,
  ProductLevel,
  EntityIdentifier,
  UntpLocation,
} from './types.js';

// Registry
export { getMapper } from './mapper-registry.js';
