/**
 * Schema Mappings Configuration Loader
 *
 * This module loads and manages schema mappings for UNTP credential types and extensions.
 * It provides a unified interface that works in both browser and Node.js environments.
 */

import { createAjvInstance } from '../utils';

interface SchemaMappingConfig {
  credentialType: string;
  versionRegex?: string;
  schemaUrlPattern: string;
}

interface SchemaMappingsFile {
  version: string;
  mappings: SchemaMappingConfig[];
}

// Cache for loaded configurations
const configCache = new Map<string, SchemaMappingConfig[]>();

/**
 * Loads the default UNTP schema mappings from the built-in configuration
 */
async function loadDefaultMappings(): Promise<SchemaMappingConfig[]> {
  const cacheKey = 'default';

  if (configCache.has(cacheKey)) {
    return configCache.get(cacheKey)!;
  }

  try {
    let mappingsData: SchemaMappingsFile;

    if (typeof window !== 'undefined') {
      // Browser environment - mappings should be embedded via browser bundle
      if ((window as any).untpDefaultSchemaMappings) {
        mappingsData = (window as any).untpDefaultSchemaMappings;
      } else {
        throw new Error(
          'Default schema mappings not found. Ensure you are using the UNTP browser bundle which embeds the default mappings.',
        );
      }
    } else {
      // Node.js environment - require the JSON file
      mappingsData = require('./default-mappings.json');
    }

    const mappings = mappingsData.mappings;
    configCache.set(cacheKey, mappings);
    return mappings;
  } catch (error) {
    console.error('Failed to load default UNTP schema mappings:', error);
    throw error;
  }
}

/**
 * Loads schema mappings from an external configuration file or object
 */
async function loadExternalMappings(configSource: string | SchemaMappingsFile): Promise<SchemaMappingConfig[]> {
  try {
    let mappingsData: SchemaMappingsFile;

    if (typeof configSource === 'string') {
      // Config source is a path/URL
      const cacheKey = configSource;

      if (configCache.has(cacheKey)) {
        return configCache.get(cacheKey)!;
      }

      if (typeof window !== 'undefined') {
        // Browser environment - fetch the config
        const response = await fetch(configSource);
        if (!response.ok) {
          throw new Error(`Failed to load schema mappings from ${configSource}: ${response.statusText}`);
        }
        mappingsData = await response.json();
      } else {
        // Node.js environment - read file
        const fs = require('fs');
        const path = require('path');

        const fullPath = path.resolve(configSource);
        const fileContent = fs.readFileSync(fullPath, 'utf8');
        mappingsData = JSON.parse(fileContent);
      }

      // Validate the mappings file
      await validateMappings(mappingsData);

      configCache.set(cacheKey, mappingsData.mappings);
    } else {
      // Config source is already an object
      mappingsData = configSource;
      // Validate the mappings file
      await validateMappings(mappingsData);
    }

    return mappingsData.mappings;
  } catch (error) {
    console.error('Failed to load external schema mappings:', error);
    throw error;
  }
}

/**
 * Validates schema mappings against the JSON Schema
 */
async function validateMappings(mappingsData: SchemaMappingsFile): Promise<void> {
  // Get the JSON Schema definition
  let schemaDefinition: any;

  if (typeof window !== 'undefined') {
    // Browser environment - schema should be embedded or available globally
    if ((window as any).untpSchemaMappingsSchema) {
      schemaDefinition = (window as any).untpSchemaMappingsSchema;
    } else {
      throw new Error(
        'Schema mappings JSON Schema not found. Ensure you are using the UNTP browser bundle which embeds the schema definition.',
      );
    }
  } else {
    // Node.js environment - load schema file
    schemaDefinition = require('./schema-mappings.schema.json');
  }

  // Use shared AJV instance creation logic
  const ajv = createAjvInstance();

  try {
    const validate = ajv.compile(schemaDefinition);
    const isValid = validate(mappingsData);

    if (!isValid) {
      const errors =
        validate.errors?.map((err: any) => `${err.instancePath} ${err.message}`).join(', ') ||
        'Unknown validation error';
      throw new Error(`Schema mappings validation failed: ${errors}`);
    }
  } catch (error) {
    throw new Error(`Failed to validate schema mappings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gets the schema URL for a credential using the loaded mappings
 * @param credential - The credential object
 * @param mappings - Array of schema mappings to search
 * @param targetType - Specific credential type to look for
 */
function getSchemaUrlFromMappings(credential: any, mappings: SchemaMappingConfig[], targetType: string): string | null {
  if (!credential.type || !Array.isArray(credential.type)) {
    return null;
  }

  // Find matching mapping by credential type
  let matchedMapping: SchemaMappingConfig | undefined;

  // Look for specific target type
  if (credential.type.includes(targetType)) {
    matchedMapping = mappings.find((mapping) => mapping.credentialType === targetType);
  } else {
    // Target type not found in credential - return null
    return null;
  }

  if (!matchedMapping) {
    return null;
  }

  // If no version regex, return the schema URL as-is
  if (!matchedMapping.versionRegex) {
    return matchedMapping.schemaUrlPattern;
  }

  // Extract version using the regex
  const credentialString = JSON.stringify(credential);
  const versionMatch = credentialString.match(new RegExp(matchedMapping.versionRegex));

  if (!versionMatch || !versionMatch[1]) {
    return null;
  }

  const version = versionMatch[1];
  return matchedMapping.schemaUrlPattern.replace('{version}', version);
}

/**
 * Combined mappings manager that handles both default and external configurations
 */
class SchemaMappingsManager {
  private allMappings: SchemaMappingConfig[] = [];
  private isLoaded = false;

  async loadMappings(externalConfigs?: (string | SchemaMappingsFile)[]): Promise<void> {
    try {
      // Always load default mappings first
      const defaultMappings = await loadDefaultMappings();
      this.allMappings = [...defaultMappings];

      // Load any external configurations
      if (externalConfigs) {
        for (const config of externalConfigs) {
          const externalMappings = await loadExternalMappings(config);
          this.allMappings.push(...externalMappings);
        }
      }

      this.isLoaded = true;
    } catch (error) {
      console.error('Failed to load schema mappings:', error);
      throw error;
    }
  }

  getSchemaUrlForCredential(credential: any, targetType: string): string | null {
    if (!this.isLoaded) {
      throw new Error('Schema mappings not loaded. Call loadMappings() first.');
    }

    return getSchemaUrlFromMappings(credential, this.allMappings, targetType);
  }

  getMappings(): SchemaMappingConfig[] {
    return [...this.allMappings];
  }

  isConfigLoaded(): boolean {
    return this.isLoaded;
  }

  clearCache(): void {
    configCache.clear();
    this.allMappings = [];
    this.isLoaded = false;
  }
}

// Create a schema mapper instance for global use
const schemaMapper = new SchemaMappingsManager();

/**
 * Get schema URL for a credential using the pre-initialized schema mapper
 */
async function getSchemaUrlForCredential(credential: any, targetType: string): Promise<string | null> {
  if (!schemaMapper.isConfigLoaded()) {
    throw new Error('Schema mapper not initialized. This should be done by the test runner.');
  }
  return schemaMapper.getSchemaUrlForCredential(credential, targetType);
}

// Make functions available in global namespace
if (typeof window !== 'undefined') {
  // Browser environment
  (window as any).untpTestSuite = {
    ...(window as any).untpTestSuite,
    SchemaMappingsManager,
    getSchemaUrlForCredential,
    loadDefaultMappings,
    loadExternalMappings,
  };
} else {
  // Node.js environment
  (global as any).untpTestSuite = {
    ...(global as any).untpTestSuite,
    SchemaMappingsManager,
    getSchemaUrlForCredential,
    loadDefaultMappings,
    loadExternalMappings,
  };
}

export {
  SchemaMappingsManager,
  getSchemaUrlForCredential,
  loadDefaultMappings,
  loadExternalMappings,
  validateMappings,
  schemaMapper,
  type SchemaMappingConfig,
  type SchemaMappingsFile,
};
