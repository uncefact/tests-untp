/**
 * Type definitions for UNTP Test Suite Mocha
 */

// Configuration for UNTP testing
export interface UNTPTestOptions {
  /** Tags to include (run only tests with these tags) */
  tags?: string[];
  /** Extension schema mapping files to load */
  extensionSchemaMaps?: string[];
  /** Callback to create and configure Mocha instance */
  mochaSetupCallback: (mochaOptions: any) => any;
}

/**
 * Core types for UNTP credential validation
 */

/**
 * Enumerates the different UNTP credential types.
 */
export enum UNTPCredentialType {
  DigitalProductPassport = 'DigitalProductPassport',
  DigitalConformityCredential = 'DigitalConformityCredential',
  DigitalFacilityRecord = 'DigitalFacilityRecord',
  DigitalIdentityAnchor = 'DigitalIdentityAnchor',
  DigitalTraceabilityEvent = 'DigitalTraceabilityEvent',
}

/**
 * Mapping of UNTP credential types to their URL abbreviations used in context URLs
 */
export const UNTP_CREDENTIAL_TYPE_ABBREVIATIONS: Record<UNTPCredentialType, string> = {
  [UNTPCredentialType.DigitalProductPassport]: 'dpp',
  [UNTPCredentialType.DigitalConformityCredential]: 'dcc',
  [UNTPCredentialType.DigitalFacilityRecord]: 'dfr',
  [UNTPCredentialType.DigitalIdentityAnchor]: 'dia',
  [UNTPCredentialType.DigitalTraceabilityEvent]: 'dte',
};
