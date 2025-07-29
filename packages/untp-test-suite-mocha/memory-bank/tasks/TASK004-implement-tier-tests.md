# [TASK004] - Implement Actual Tier 1 and Tier 2 Tests

**Status:** Pending
**Priority:** High
**Tags:** testing, tier1, tier2, validation, implementation
**Added:** 2025-07-25
**Updated:** 2025-07-25

## Original Request
Add actual tier 1 and tier 2 tests, re-using code from existing code-bases (likely untp-graph-validation-cli) to replace the current dummy tests with real UNTP credential validation logic.

## Thought Process
Currently we have a working test architecture with dummy placeholder tests. The next step is to implement the actual UNTP validation logic for tier 1 and tier 2 testing by leveraging existing validation code from the untp-graph-validation-cli project.

### Current State Analysis
- **Tier 1 Tests**: Currently has dummy tests that check basic JSON structure and JSON-LD context
- **Tier 2 Tests**: Not implemented yet
- **Test Structure**: Working per-credential test suites with proper hierarchy and tag display
- **Architecture**: Solid foundation with registerUNTPTestSuite pattern

### Tier 1 Requirements (W3C Verifiable Credential Validation)
From the project brief, Tier 1 should ensure each credential file is:
- Valid JSON
- Valid JSON Linked Data 
- Conforms to the W3C Verifiable Credential schema

### Tier 2 Requirements (UNTP Schema Validation)
From the project brief, Tier 2 should:
- Determine the UNTP credential type
- Validate credentials against UNTP-specific schemas
- Check required fields for each credential type

### Code Reuse Strategy
The untp-graph-validation-cli likely contains:
- JSON schema validation utilities
- W3C VC validation logic
- UNTP credential type detection
- UNTP schema validation for different credential types
- Error handling and reporting patterns

## Implementation Plan
- Research existing validation code in untp-graph-validation-cli
- Extract reusable validation utilities and adapt for Mocha test environment
- Replace dummy tier 1 tests with actual W3C VC validation tests
- Create tier 2 test files with UNTP-specific validation logic
- Implement credential type detection for proper schema selection
- Add comprehensive test coverage for all supported UNTP credential types
- Ensure error messages are clear and actionable for users
- Test with variety of valid and invalid credential samples
- Update test tags to reflect actual validation categories

## Progress Tracking

**Overall Status:** Pending - 0%

### Task Metadata
- **Priority Level:** High - Core functionality for UNTP validation
- **Tags:** testing, tier1, tier2, validation, implementation
- **Dependencies:** TASK003 (completed - test architecture ready)
- **Estimated Effort:** 3-5 days

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 4.1 | Research untp-graph-validation-cli codebase | Completed | 2025-07-29 | Code reorganized, validation components analyzed |
| 4.2 | Extract and adapt validation utilities | Completed | 2025-07-29 | Created shared validation helpers and AJV setup |
| 4.3 | Implement actual Tier 1 W3C VC validation tests | Completed | 2025-07-29 | Replaced dummy tests with real JSON-LD and schema validation |
| 4.4 | Create Tier 2 UNTP schema validation tests | Not Started | 2025-07-25 | New test files for UNTP-specific validation |
| 4.5 | Add credential type detection logic | Not Started | 2025-07-25 | Determine credential type for proper schema selection |
| 4.6 | Test with comprehensive credential samples | Not Started | 2025-07-25 | Validate against variety of credential types |
| 4.7 | Refine error messages and user experience | Not Started | 2025-07-25 | Ensure clear, actionable validation feedback |
| 4.8 | Update test tags and documentation | Not Started | 2025-07-25 | Reflect actual validation categories in tags |

## Progress Log
### 2025-07-29
- **Completed subtasks 4.1-4.3**: Implemented actual tier 1 validation tests
- **Added real validation logic**: Extracted and adapted validation components from untp-graph-validation-cli
  - `extractUNTPVersion()` function for all UNTP credential types  
  - `validateJSONLD()` function with proper JSON-LD expansion validation
  - `validateJsonAgainstSchema()` function with AJV and JSON Schema 2020-12 support
- **Custom Chai assertions**: Created expressive test syntax
  - `expect(credential).to.be.a.validJSONLDDocument`
  - `expect(credential).to.match.schema(schemaUrl)`
- **Universal compatibility**: All validation works in both Node.js and browser environments
- **Resolved browser issues**: Fixed AJV constructor access, function naming conflicts, and execution order
- **Code organization**: Moved createAjvInstance to utils.ts for better separation of concerns
- **Tests working**: Real tier 1 validation replacing dummy tests, actual W3C VC schema validation

### 2025-07-28
- Started subtask 4.1 - Research untp-graph-validation-cli codebase
- Completed code reorganization to prepare for validation implementation
- Moved core files to src/untp-test/ directory for cleaner structure:
  - test-helpers.ts → utils.ts
  - validator.ts, stream-reporter.ts, credential-state.ts, browser-bundle.ts
  - Consolidated type definitions in main src/types.ts
- **Important lesson learned**: Should use `git mv` instead of move_path tool to preserve git history
- Updated all import paths and verified TypeScript compilation
- Fixed browser test script to use new browser-bundle.ts location
- Verified `npm run browser-test` works correctly after reorganization
- Clean structure now ready for validation logic integration

### 2025-07-25
- Task created to implement actual UNTP validation logic
- Current dummy tests provide good foundation but need real validation
- Plan to leverage existing untp-graph-validation-cli codebase for proven validation logic
- Architecture from TASK003 ready to support real tier 1 and tier 2 tests
- Goal is comprehensive UNTP credential validation with clear user feedback

## Success Criteria
- **Tier 1 Tests**: Comprehensive W3C Verifiable Credential validation
- **Tier 2 Tests**: Full UNTP schema validation for all supported credential types
- **Type Detection**: Automatic credential type identification
- **Error Reporting**: Clear, actionable validation messages
- **Test Coverage**: Support for all major UNTP credential types
- **User Experience**: Easy to understand what failed and how to fix it
- **Performance**: Fast validation suitable for CI/CD environments
- **Extensibility**: Easy to add new credential types and validation rules

## Related Resources
- untp-graph-validation-cli codebase
- W3C Verifiable Credentials specification
- UNTP credential schemas and documentation
- Example credential files in example-credentials/ directory