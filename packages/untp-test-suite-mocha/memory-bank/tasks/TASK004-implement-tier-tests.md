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
| 4.1 | Research untp-graph-validation-cli codebase | Not Started | 2025-07-25 | Identify reusable validation components |
| 4.2 | Extract and adapt validation utilities | Not Started | 2025-07-25 | Create shared validation helpers |
| 4.3 | Implement actual Tier 1 W3C VC validation tests | Not Started | 2025-07-25 | Replace dummy tests with real validation |
| 4.4 | Create Tier 2 UNTP schema validation tests | Not Started | 2025-07-25 | New test files for UNTP-specific validation |
| 4.5 | Add credential type detection logic | Not Started | 2025-07-25 | Determine credential type for proper schema selection |
| 4.6 | Test with comprehensive credential samples | Not Started | 2025-07-25 | Validate against variety of credential types |
| 4.7 | Refine error messages and user experience | Not Started | 2025-07-25 | Ensure clear, actionable validation feedback |
| 4.8 | Update test tags and documentation | Not Started | 2025-07-25 | Reflect actual validation categories in tags |

## Progress Log
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