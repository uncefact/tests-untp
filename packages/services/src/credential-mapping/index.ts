// Types
export type {
  ICredentialMapper,
  MapperOutput,
  ExtractedIdentifierRefs,
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
export { registerMapper, getMapper, listRegisteredMappers } from './mapper-registry.js';

// Initialisation
export { initBuiltInMappers } from './init.js';
