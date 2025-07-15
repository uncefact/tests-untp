# TASK003 - Replace Config File with Individual File Arguments

**Status:** Pending
**Priority:** High
**Tags:** cli, refactor, api-simplification, user-experience
**Added:** 2025-07-15
**Updated:** 2025-07-15

## Original Request
Add support for individual files as args and a `-d` / `--directory` option for passing a directory to the CLI (so the CLI would construct the list of file paths based on the directory contents, before passing them to the test lib). Keep

## Thought Process
This task is the next logical step after TASK001 in the larger refactor to make the untp-test-suite more reusable with a simple API. Now that we can infer version and type from credential data, we can eliminate the config file entirely and provide a more intuitive CLI interface.

The current CLI requires users to:
1. Create a `credentials.json` config file
2. List each credential file with its path
3. Run the CLI with `--config=./credentials.json`

The new CLI should allow users to:
1. Pass individual credential files directly: `untp test file1.json file2.json file3.json`
2. Pass a directory to scan: `untp test -d ./credentials/`
3. Combine both approaches: `untp test -d ./credentials/ additional-file.json`

This will make the CLI much more user-friendly and align with common CLI patterns.

## Implementation Plan
1. **Update CLI argument parsing**
   - Remove the `--config` option requirement
   - Add support for individual file arguments
   - Add `-d` / `--directory` option for directory scanning
   - Maintain existing `--config` option for transition period

2. **Implement directory scanning logic**
   - Create utility function to scan directory for credential files
   - Filter for JSON files (or other credential formats)
   - Handle nested directories (optional recursive scanning)
   - Validate that found files are actually credentials

3. **Update CLI command processing**
   - Modify the CLI to construct file paths list from arguments
   - Pass the file paths list to the existing test library
   - Handle mixed arguments (files + directories)

4. **Update help text and documentation**
   - Update CLI help text to show new usage patterns
   - Update README.md with new CLI examples
   - Document the new API in the package documentation

5. **Test and validate**
   - Test CLI with individual file arguments
   - Test CLI with directory option
   - Test CLI with mixed arguments
   - Ensure backward compatibility with config file option
   - Update integration tests

## Progress Tracking

**Overall Status:** Not Started - 0%

### Task Metadata
- **Priority Level:** High - Key step in API simplification
- **Tags:** cli, refactor, api-simplification, user-experience
- **Dependencies:** TASK001 (Remove Version Property Dependency) - Completed
- **Estimated Effort:** 3-4 hours

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 3.1 | Update CLI argument parsing | Not Started | 2025-07-15 | Add support for individual files and -d option |
| 3.2 | Implement directory scanning logic | Not Started | 2025-07-15 | Create utility to scan for credential files |
| 3.3 | Update CLI command processing | Not Started | 2025-07-15 | Modify CLI to construct file paths list |
| 3.4 | Update help text and documentation | Not Started | 2025-07-15 | Update README and CLI help |
| 3.5 | Test and validate changes | Not Started | 2025-07-15 | Ensure all use cases work correctly |

## Progress Log
### 2025-07-15
- Task created based on the need to complete the API simplification
- Initial analysis and planning completed
- Ready to begin implementation after TASK001 completion

## Implementation Notes

### New CLI Usage Examples
```bash
# Test individual files
untp test credential1.json credential2.json

# Test all credentials in a directory
untp test -d ./credentials/

# Test directory plus additional files
untp test -d ./credentials/ extra-credential.json

# Transition period - existing config file approach (will be deprecated)
untp test --config=./credentials.json
```

### Directory Scanning Considerations
- Should scan for `.json` files by default
- May need to validate files are actually credentials (have required fields)
- Consider recursive scanning option (`-r` / `--recursive`)
- Handle edge cases like empty directories, no JSON files found

### API Integration
- The existing test library already supports processing individual files
- Need to convert CLI arguments to the format expected by the test library
- Can leverage the version/type inference from TASK001

### Transition Period Strategy
- Keep the `--config` option working during transition period
- Provide clear migration path in documentation
- Add deprecation warnings for config file usage to encourage migration
- Plan for eventual removal of config file support in future version