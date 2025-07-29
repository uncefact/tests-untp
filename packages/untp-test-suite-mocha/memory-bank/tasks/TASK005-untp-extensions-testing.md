# [TASK005] - UNTP Extensions Testing Support

**Status:** Pending
**Priority:** Medium
**Tags:** extensions, custom-schemas, configuration, testing, untp
**Added:** 2025-07-29
**Updated:** 2025-07-29

## Original Request
Add a new task to test UNTP extensions, including supporting configurable custom schemas for a credential extension.

## Thought Process
The UNTP test suite needs to be extensible to support custom credential types beyond the core UNTP credential types (DPP, DCC, DFR, DIA, DTE). Organizations may create their own credential extensions that build upon UNTP foundations but have additional or modified schema requirements.

### Current State Analysis
- **Core UNTP Support**: The test suite currently supports all standard UNTP credential types
- **Schema Detection**: `getUNTPCredentialType()` and `getUNTPSchemaUrlForCredential()` work for standard types
- **Hardcoded Logic**: Schema URLs are generated using hardcoded patterns for core UNTP types
- **Extension Gap**: No mechanism to configure custom credential types or schemas

### Extension Requirements
From the project brief, the library should support extension testing by allowing users to specify additional directories containing Mocha tests. However, we also need:

1. **Custom Schema Configuration**: Ability to map custom credential types to their schema URLs
2. **Extension Type Detection**: Extend credential type detection beyond core UNTP types
3. **Configurable Schema Resolution**: Allow users to provide custom schema URL patterns or mappings
4. **Extension Test Integration**: Seamless integration with existing test infrastructure

### Design Considerations
- **Configuration Format**: JSON/YAML config file or programmatic API
- **Schema Mapping**: Type → Schema URL mapping with version support
- **Backward Compatibility**: Core UNTP functionality should remain unchanged
- **API Consistency**: Extensions should use same clean API as core tests
- **Validation Logic**: Same validation infrastructure (AJV, Chai assertions)

## Implementation Plan
- Design configuration format for custom credential types and schemas
- Decide whether `getUNTPCredentialType()` should be extended to support configurable custom types (not convinced)
- Extend `getUNTPSchemaUrlForCredential()` to use configurable schema mappings, or a separate function for extensions of UNTP credentials.
- Create configuration loading mechanism (file-based and programmatic)
- Add CLI support for extension configuration (`--config` option)
- Create example extension configuration and test files
- Document extension development workflow
- Test with real extension scenarios
- Update browser bundle to support extension configuration
- Add validation for extension configuration format

## Progress Tracking

**Overall Status:** Pending - 0%

### Task Metadata
- **Priority Level:** Medium - Important for ecosystem extensibility
- **Tags:** extensions, custom-schemas, configuration, testing, untp
- **Dependencies:** TASK004 (core UNTP validation working)
- **Estimated Effort:** 4-6 days

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 5.1 | Design extension configuration format | Not Started | 2025-07-29 | JSON schema for custom credential types and schema mappings |
| 5.2 | Extend credential type detection for custom types | Not Started | 2025-07-29 | Make getUNTPCredentialType() configurable |
| 5.3 | Extend schema URL resolution for custom schemas | Not Started | 2025-07-29 | Make getUNTPSchemaUrlForCredential() configurable or provide different fn for extensions |
| 5.4 | Add configuration loading mechanism | Not Started | 2025-07-29 | File-based and programmatic configuration loading |
| 5.5 | Add CLI support for extension configuration | Not Started | 2025-07-29 | --config option for specifying extension config |
| 5.6 | Create example extension and documentation | Not Started | 2025-07-29 | Working example of custom credential extension |
| 5.7 | Add browser support for extension configuration | Not Started | 2025-07-29 | Runtime configuration in browser environment |
| 5.8 | Test with real extension scenarios | Not Started | 2025-07-29 | Validate extensibility with realistic use cases |

## Progress Log
### 2025-07-29
- Task created to support UNTP credential extensions
- Need to design configuration format that supports custom credential types
- Should leverage existing validation infrastructure while adding configurability
- Important for ecosystem adoption - organizations need to extend UNTP for their specific use cases

## Success Criteria
- **Configuration Format**: Clear, documented format for specifying custom credential types and schemas
- **API Consistency**: Extensions use same clean API as core UNTP types
- **CLI Integration**: `untp-test --config extensions.json credentials/` works seamlessly
- **Browser Support**: Runtime configuration works in browser environment
- **Documentation**: Clear guide for creating and testing credential extensions
- **Examples**: Working example extension with custom schema and tests
- **Backward Compatibility**: Core UNTP functionality unaffected by extension system
- **Validation**: Extension configuration validated to prevent misconfigurations

## Related Resources
- UNTP specification for extension guidelines
- Existing `getUNTPCredentialType()` and `getUNTPSchemaUrlForCredential()` functions
- Current test architecture and tag system
- Example custom credential extensions from UNTP community

## Configuration Design Ideas

### Example Extension Configuration Format
```json
{
  "extensions": {
    "customTypes": [
      {
        "name": "CustomProductPassport",
        "contextPattern": "https://example.org/vocab/custom-dpp/{version}/",
        "schemaUrlPattern": "https://example.org/schemas/custom-dpp-schema-{version}.json",
        "abbreviation": "cdpp",
        "description": "Custom Digital Product Passport extension"
      }
    ],
    "testDirectories": [
      "./extensions/tests/"
    ]
  }
}
```

### Programmatic API Example
```javascript
const { configureExtensions } = require('untp-test-suite-mocha');

configureExtensions({
  customTypes: [
    {
      name: 'CustomConformityCredential',
      schemaUrl: 'https://company.com/schema/custom-cc-v1.json',
      typeDetection: (credential) => credential.type?.includes('CustomConformityCredential')
    }
  ]
});
```
