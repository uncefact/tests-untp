# TASK006 - Update Dynamic Schema Service to Accept Full Credential and Type Parameter

**Status:** Pending
**Priority:** High
**Tags:** schema-loading, api-improvement, dynamic-loading, credential-type, extensibility
**Added:** 2025-07-17
**Updated:** 2025-07-17

## Original Request
Update the dynamic JSON schema function `dynamicLoadingSchemaService` so that it can return the schema for a specific type, for a credential. That is, rather than the version arg, let's pass the full credential. So if called with a digital product passport with type set to `VerifiableCredential`, the relevant verifiable credential schema will be returned for the credential. If the same credential is passed with the type as `DigitalProductPassport`, the relevant UNTP DPP schema for the version of the credential is returned. This would also enable flexibility in the future to support extensions (with a map as per TASK004).

## Thought Process
This task represents a significant improvement to the schema loading service that will enable more flexible schema resolution. The current implementation requires separate extraction of type and version from the credential, but the new approach will:

1. **Pass the full credential**: Instead of pre-extracting type and version, pass the entire credential object
2. **Specify target schema type**: Add a type parameter to specify which schema to return (e.g., 'VerifiableCredential' vs 'DigitalProductPassport')
3. **Internal extraction**: Let the service handle version extraction internally from the credential's @context
4. **Enable multi-schema support**: This change prepares for TASK004's multi-schema validation where we need different schemas for the same credential

The key insight is that a single credential can be validated against multiple schemas:
- **Tier 1**: VerifiableCredential schema (W3C standard)
- **Tier 2**: UNTP-specific schema (DigitalProductPassport, DigitalTraceabilityEvent, etc.)

This change will make the service more intuitive and prepare for the tiered testing architecture.

## Implementation Plan

### 1. Update Function Signature
- Change from `dynamicLoadingSchemaService(type: string, version: string, url?: string)` 
- To `dynamicLoadingSchemaService(credential: any, schemaType: string, url?: string)`
- Update TypeScript interface in `types.ts`

### 2. Internal Version Extraction
- Move version extraction logic inside the service
- Use existing `extractVersionFromContext` function
- Handle cases where version cannot be determined

### 3. Schema Type Resolution Logic
- **'VerifiableCredential'**: Return W3C VerifiableCredential schema
- **UNTP types**: Extract version from credential and return appropriate UNTP schema
- **Custom types**: Prepare for future extension mapping support

### 4. Update All Call Sites
- Update `processTestSuite.ts` to pass credential and schema type
- Update all test files to use new signature
- Ensure backward compatibility during transition

### 5. Enhanced Error Handling
- Better error messages that reference the credential context
- Handle missing @context gracefully
- Validate schema type parameter

### 6. Documentation Updates
- Update function documentation
- Add usage examples for different schema types
- Document the relationship to tiered testing

## Progress Tracking

**Overall Status:** Not Started - 0%

### Task Metadata
- **Priority Level:** High - Key improvement for schema loading flexibility
- **Tags:** schema-loading, api-improvement, dynamic-loading, credential-type, extensibility
- **Dependencies:** None (can be implemented immediately)
- **Estimated Effort:** 4-6 hours

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 6.1 | Update function signature and TypeScript interface | Not Started | 2025-07-17 | Change from (type, version) to (credential, schemaType) |
| 6.2 | Implement internal version extraction | Not Started | 2025-07-17 | Use extractVersionFromContext internally |
| 6.3 | Implement schema type resolution logic | Not Started | 2025-07-17 | Handle VerifiableCredential vs UNTP types |
| 6.4 | Update all call sites in codebase | Not Started | 2025-07-17 | processTestSuite.ts and other locations |
| 6.5 | Update test files for new signature | Not Started | 2025-07-17 | Ensure all tests pass with new API |
| 6.6 | Enhanced error handling and validation | Not Started | 2025-07-17 | Better error messages and edge cases |
| 6.7 | Update documentation and examples | Not Started | 2025-07-17 | Function docs and usage examples |

## Progress Log
### 2025-07-17
- Task created to improve schema loading service flexibility
- Initial analysis completed, ready to begin implementation
- This change will prepare the foundation for TASK004's multi-schema validation

## Implementation Details

### New Function Signature
```typescript
export const dynamicLoadingSchemaService = async (
  credential: any, 
  schemaType: string, 
  url?: string
): Promise<JSON | string>
```

### Usage Examples
```typescript
// Get VerifiableCredential schema for any credential
const vcSchema = await dynamicLoadingSchemaService(credential, 'VerifiableCredential');

// Get UNTP-specific schema for the same credential
const dppSchema = await dynamicLoadingSchemaService(credential, 'DigitalProductPassport');

// With explicit URL (existing behavior)
const customSchema = await dynamicLoadingSchemaService(credential, 'CustomType', 'https://example.com/schema.json');
```

### Schema Type Resolution Logic
1. **URL provided**: Fetch from URL (existing behavior)
2. **'VerifiableCredential'**: Return W3C VerifiableCredential schema
3. **UNTP types**: Extract version from credential's @context and return appropriate UNTP schema
4. **Unknown types**: Return error or prepare for extension mapping (TASK004)

### Error Handling Improvements
- "Unable to extract version from credential @context" instead of generic version errors
- "Unknown schema type: {schemaType}" for unsupported types
- "Credential is missing required @context field" for malformed credentials

### Integration with Tiered Testing
This change directly supports the tiered testing architecture:
- **Tier 1**: `dynamicLoadingSchemaService(credential, 'VerifiableCredential')`
- **Tier 2**: `dynamicLoadingSchemaService(credential, extractedUntpType)`

### Future Extension Support
The new signature prepares for TASK004's extension mapping:
```typescript
// Future: Extension mapping support
const extensionSchema = await dynamicLoadingSchemaService(
  credential, 
  'ExtendedProductPassport', 
  extensionConfig.getSchemaUrl('ExtendedProductPassport', version)
);
```

## Call Site Updates Required

### processTestSuite.ts
```typescript
// Current:
const effectiveType = extractCredentialType(data);
const effectiveVersion = extractVersionFromContext(data);
const schema = await dynamicLoadingSchemaService(effectiveType, effectiveVersion, url);

// New:
const effectiveType = extractCredentialType(data);
const schema = await dynamicLoadingSchemaService(data, effectiveType, url);
```

### Test Files
- Update all mock calls in test files
- Ensure test credentials have proper @context for version extraction
- Add new test cases for different schema types

## Success Criteria
- [ ] Function signature updated to accept credential and schema type
- [ ] Version extraction moved inside the service
- [ ] All existing functionality preserved
- [ ] New schema type parameter works correctly
- [ ] All tests pass with new implementation
- [ ] Error handling improved with better messages
- [ ] Documentation updated with new usage patterns
- [ ] Backward compatibility maintained during transition
- [ ] Foundation prepared for TASK004's multi-schema validation

## Benefits
- **Improved API**: More intuitive to pass credential and specify desired schema type
- **Tiered Testing Ready**: Enables easy validation against multiple schemas
- **Better Error Messages**: Context-aware error reporting
- **Extension Ready**: Prepares for TASK004's extension mapping support
- **Cleaner Code**: Reduces duplication of version extraction logic

This change will significantly improve the flexibility of the schema loading service while maintaining all existing functionality and preparing for the multi-schema validation capabilities needed for tiered testing.