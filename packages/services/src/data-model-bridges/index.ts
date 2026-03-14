export type {
  IDataModelBridge,
  ExtractedRefs,
  ConformityInput,
  ResolvedEntities,
  OrganisationEntity,
  FacilityEntity,
  ProductEntity,
  ProductLevel,
  EntityIdentifier,
  UntpLocation,
  CredentialSubject,
  DataModelConfig,
} from './types.js';

export { getBridge } from './bridge-registry.js';
export { buildContextAndTypes } from './primitives/context.js';
