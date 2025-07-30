/**
 * Schema Mapper Module
 *
 * Provides configuration-based mapping from credential types to their schema URLs.
 * Supports both built-in UNTP credential types and configurable extensions.
 */

export {
  SchemaMappingsManager,
  getSchemaUrlForCredential,
  loadDefaultMappings,
  loadExternalMappings,
  validateMappings,
  type SchemaMappingConfig,
  type SchemaMappingsFile,
} from './loader';
