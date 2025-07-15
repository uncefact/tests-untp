# TASK001 - Remove Version Property Dependency from Config File

**Status:** Completed
**Priority:** High
**Tags:** refactor, config, api-cleanup
**Added:** 2025-07-14
**Updated:** 2025-07-15

## Original Request
Based on the active context, the next step in refactoring the untp-test-suite to support a list of file paths as the API (rather than the current config file) is to remove the dependence on the `version` property of the config file. The version can be inferred from the UNTP specific context to which the credential points.

## Thought Process
This task is part of a larger refactor to make the untp-test-suite more reusable across different UX implementations (CLI, web, mobile). The current config file approach requires redundant information and makes integration difficult for web UX scenarios.

The previous step (removing dependence on the `type` property) was already completed in PR #307. Now we need to eliminate the `version` property dependency by inferring the version from the UNTP-specific context within the credential itself.

This approach will:
1. Reduce redundant configuration requirements
2. Make the API simpler and more intuitive
3. Move us closer to the goal of a simple file-paths-based API
4. Align with the implementation in the untp-graph-validation-cli POC

## Implementation Plan
1. **Analyze current version property usage**
   - Identify all places where the `version` property from config is currently used
   - Understand how version information is embedded in UNTP credentials
   - Document the mapping between config version and credential context

2. **Implement version inference logic**
   - Create utility function to extract version from credential's UNTP context
   - Handle edge cases where version might not be clearly defined
   - Ensure backward compatibility during transition

3. **Update test logic**
   - Modify tier 1 and tier 2 validation to use inferred version
   - Update any version-specific schema validation logic
   - Ensure all existing tests still pass

4. **Remove version property from config**
   - Update config file schema/types to remove version property
   - Clean up any unused version-related code
   - Update documentation and examples

5. **Test and validate**
   - Run full test suite to ensure no regressions
   - Test with various credential types and versions
   - Verify the change works with existing credential files

## Progress Tracking

**Overall Status:** Completed - 100%

### Task Metadata
- **Priority Level:** High - This is a key step in the API refactor
- **Tags:** refactor, config, api-cleanup
- **Dependencies:** Previous step (remove type property) must be complete
- **Estimated Effort:** 1-2 hours

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 1.1 | Analyze current version property usage | Complete | 2025-07-15 | Found version in config file and @context URL pattern |
| 1.2 | Implement version inference logic | Complete | 2025-07-15 | Created extractVersionFromContext and extractCredentialType functions |
| 1.3 | Update test logic to use inferred version | Complete | 2025-07-15 | Modified processCheckDataBySchema to use inferred version |
| 1.4 | Remove version property from config | Complete | 2025-07-15 | Updated types and validation logic |
| 1.5 | Test and validate changes | Complete | 2025-07-15 | All tests passing, CLI working with version inference |

## Progress Log
### 2025-07-15
- **TASK COMPLETED**: Successfully implemented version inference from credential @context
- **Analysis Complete**: Found that version is currently read from config file `credentials.json`
- **Pattern Discovery**: Version is embedded in credential @context URLs (e.g., `https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/`)
- **Implementation**: 
  - Created `extractVersionFromContext()` function to extract version from @context URLs
  - Created `extractCredentialType()` function to extract credential type from type field
  - Updated `processCheckDataBySchema()` to use inferred version and type
  - Modified `IConfigContent` interface to make version optional
  - Updated validation logic to not require version in config
  - Fixed TypeScript errors in `loadingSchema.service.ts`
  - Updated test mocks to use real implementations of new functions
- **Testing**: All unit tests passing, CLI tool working correctly with version inference
- **Validation**: Tested CLI with modified credentials.json (version properties removed) - successfully infers v0.5.0 and v0.4.2 from credentials

### 2025-07-14
- Task created based on active context requirements
- Initial analysis and planning completed
- Ready to begin implementation