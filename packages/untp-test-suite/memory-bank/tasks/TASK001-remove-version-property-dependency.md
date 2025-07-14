# TASK001 - Remove Version Property Dependency from Config File

**Status:** Pending
**Priority:** High
**Tags:** refactor, config, api-cleanup
**Added:** 2025-07-14
**Updated:** 2025-07-14

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

**Overall Status:** Not Started - 0%

### Task Metadata
- **Priority Level:** High - This is a key step in the API refactor
- **Tags:** refactor, config, api-cleanup
- **Dependencies:** Previous step (remove type property) must be complete
- **Estimated Effort:** 1-2 hours

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 1.1 | Analyze current version property usage | Not Started | 2025-07-14 | Need to understand current implementation |
| 1.2 | Implement version inference logic | Not Started | 2025-07-14 | Core logic for extracting version from credential context |
| 1.3 | Update test logic to use inferred version | Not Started | 2025-07-14 | Modify tier 1 and 2 validation |
| 1.4 | Remove version property from config | Not Started | 2025-07-14 | Clean up config schema and unused code |
| 1.5 | Test and validate changes | Not Started | 2025-07-14 | Ensure no regressions |

## Progress Log
### 2025-07-14
- Task created based on active context requirements
- Initial analysis and planning completed
- Ready to begin implementation