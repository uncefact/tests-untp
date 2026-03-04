// Types
export type { ICvcParser, ParsedCvcCatalogue, ParsedCvcScheme, ParsedCvcProfile, ParsedCvcCriterion } from './types.js';

// Registry
export { getCvcParser, SUPPORTED_CVC_VERSIONS } from './cvc-parser-registry.js';

// Parsers (for direct use in tests / seed scripts)
export { CvcV070Parser } from './parsers/cvc-v070.parser.js';
