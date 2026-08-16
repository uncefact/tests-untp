export type {
  IDataModelBridge,
  ExtractedRefs,
  ConformityRefs,
  ConformityInput,
  BridgeEntities,
  TraceabilityEventInput,
  OrganisationEntity,
  FacilityEntity,
  ProductEntity,
  ProductLevel,
  EntityIdentifier,
  UntpLocation,
  CredentialSubject,
  DataModelConfig,
  ClaimSourceMap,
  ConformityClaimWithProvenance,
} from './types.js';

export { getBridge } from './bridge-registry.js';
export { buildContextAndTypes } from './primitives/context.js';
