# TASK005 - Update API Types for File-Path Based Interface

**Status:** Pending
**Priority:** Medium
**Tags:** api-types, library-interface, typescript, file-based-api
**Added:** 2025-07-16
**Updated:** 2025-07-16

## Original Request
Add another task to update the actual exposed API types in testSuiteHandler.ts for the new filepath API with optional extension config.

## Thought Process
While TASK003 successfully implemented the file-based API internally, the exposed library API types in `testSuiteHandler.ts` still reflect the old config-based approach. We need to update these types to properly reflect the new file-path based API and prepare for the optional extension config from TASK004.

The current API types are somewhat confusing and don't clearly represent the intended usage patterns. We should create clean, intuitive types that match the actual implementation and future extension capabilities.

## Implementation Plan

### 1. Analyze Current API Types
- Review existing `TestCredentialsHandler` and `TestCredentialHandler` interfaces
- Identify inconsistencies with actual implementation
- Document current usage patterns vs. intended patterns

### 2. Design New File-Based API Types
- Create clear interfaces for file-path based testing
- Support both single file and multiple file scenarios
- Prepare for optional extension schema mapping integration
- Maintain backward compatibility where possible

### 3. Update TestCredentialsHandler Interface
- Primary signature: `(filePaths: string | string[]) => Promise<ITestSuiteResult>`
- Secondary signature: `(filePaths: string | string[], config?: ExtensionConfig) => Promise<ITestSuiteResult>`
- Remove config object overloads that don't match implementation

### 4. Update TestCredentialHandler Interface
- Primary signature: `(filePath: string, testData?: object) => Promise<ICredentialTestResult>`
- Secondary signature: `(filePath: string, testData?: object, config?: ExtensionConfig) => Promise<ICredentialTestResult>`
- Remove confusing config-based signatures

### 5. Create Extension Config Types
- Define `ExtensionConfig` interface for TASK004 integration
- Support schema mapping for credential extensions
- Keep it optional and simple

### 6. Update Implementation Functions
- Ensure `testCredentialsHandler` and `testCredentialHandler` match new types
- Update JSDoc comments to reflect new API patterns
- Add deprecation warnings for old patterns if needed

## Progress Tracking

**Overall Status:** Not Started - 0%

### Task Metadata
- **Priority Level:** Medium - Important for API clarity but not blocking
- **Tags:** api-types, library-interface, typescript, file-based-api
- **Dependencies:** TASK003 (Replace Config File with Individual File Arguments) - Completed
- **Estimated Effort:** 2-3 hours

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 5.1 | Analyze current API types | Not Started | 2025-07-16 | Review existing interfaces and usage patterns |
| 5.2 | Design new file-based API types | Not Started | 2025-07-16 | Create clean, intuitive interfaces |
| 5.3 | Update TestCredentialsHandler interface | Not Started | 2025-07-16 | File-path based signatures |
| 5.4 | Update TestCredentialHandler interface | Not Started | 2025-07-16 | Single file testing interface |
| 5.5 | Create extension config types | Not Started | 2025-07-16 | Schema mapping for credential extensions |
| 5.6 | Update implementation functions | Not Started | 2025-07-16 | Ensure functions match new types |

## Progress Log
### 2025-07-16
- Task created to address API type inconsistencies
- Initial analysis and planning completed
- Ready to begin implementation after TASK003 completion

## Implementation Notes

### Current API Issues
- `TestCredentialsHandler` has confusing overloads for string vs config objects
- `TestCredentialHandler` takes config but omits dataPath, which is inconsistent
- Types don't clearly reflect the file-based nature of the new API
- Missing support for future extension schema mapping

### Proposed New API Types
```typescript
// Extension config for TASK004 - schema mapping only
interface ExtensionConfig {
  schemaMapping?: Record<string, string | Record<string, string>>;
}

// Updated TestCredentialsHandler
interface TestCredentialsHandler {
  // Primary: Test single file
  (filePath: string, config?: ExtensionConfig): Promise<ITestSuiteResult>;
  
  // Primary: Test multiple files
  (filePaths: string[], config?: ExtensionConfig): Promise<ITestSuiteResult>;
  
  // Legacy: Config file path (deprecated)
  (configFilePath: string): Promise<ITestSuiteResult>;
}

// Updated TestCredentialHandler
interface TestCredentialHandler {
  // Primary: Test single file with optional test data override
  (filePath: string, testData?: object, config?: ExtensionConfig): Promise<ICredentialTestResult>;
}
```

### Migration Strategy
1. **Phase 1**: Update types to match current implementation
2. **Phase 2**: Add extension schema mapping support (TASK004)
3. **Phase 3**: Deprecate old config-based overloads
4. **Phase 4**: Remove deprecated overloads in future version

### Benefits of New API Types
- **Clear and intuitive**: Types clearly show file-path based usage
- **Consistent**: Matches actual implementation behavior
- **Extensible**: Prepared for extension schema mapping integration
- **Backward compatible**: Legacy usage patterns still supported
- **Well-documented**: Clear JSDoc comments for each usage pattern

### Testing Considerations
- Ensure all existing library users continue to work
- Test new type signatures with TypeScript compiler
- Validate that IntelliSense shows correct suggestions
- Check that examples in documentation match new types

## Success Criteria
- [ ] API types accurately reflect file-based implementation
- [ ] Clear, intuitive signatures for common use cases
- [ ] Extension schema mapping types prepared for TASK004
- [ ] Backward compatibility maintained
- [ ] TypeScript compilation without errors
- [ ] Updated JSDoc comments and examples
- [ ] Library interface is easy to understand and use

This task will clean up the API types to match the excellent file-based implementation from TASK003 and prepare for the extension schema mapping capabilities in TASK004.