# TASK003 - Replace Config File with Individual File Arguments

**Status:** Completed
**Priority:** High
**Tags:** cli, refactor, api-simplification, user-experience
**Added:** 2025-07-15
**Updated:** 2025-07-16

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

**Overall Status:** Completed - 100%

### Task Metadata
- **Priority Level:** High - Key step in API simplification
- **Tags:** cli, refactor, api-simplification, user-experience
- **Dependencies:** TASK001 (Remove Version Property Dependency) - Completed
- **Estimated Effort:** 3-4 hours

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 3.1 | Update CLI argument parsing | Complete | 2025-07-16 | Added support for individual files and -d option |
| 3.2 | Implement directory scanning logic | Complete | 2025-07-16 | Created fileScanner utility with filtering |
| 3.3 | Update CLI command processing | Complete | 2025-07-16 | Refactored core functions to use file paths directly |
| 3.4 | Update help text and documentation | Complete | 2025-07-16 | Updated README with new CLI usage patterns |
| 3.5 | Test and validate changes | Complete | 2025-07-16 | All use cases tested and working after refactoring |
| 3.6 | Refactor core functions to use file paths | Complete | 2025-07-16 | Core functions now use file paths as primary input |
| 3.7 | Additional improvements and fixes | Complete | 2025-07-16 | Fixed variable naming, eliminated wrapper functions, improved library interface |

## Progress Log
### 2025-07-16 (Additional Improvements)
- **ADDITIONAL IMPROVEMENTS COMPLETED** - Several code quality and architectural improvements
- **Fixed misleading variable name**: Changed `credentialPath` to `configPath` in CLI test command for clarity
- **Improved file validation**: Updated `isCredentialFile` to validate based on VerifiableCredential content instead of filename patterns
- **Removed file extension restrictions**: Now supports `.jsonld` and other extensions by validating content only
- **Eliminated wrapper functions**: Removed `processCheckDataBySchemaForConfig` and `processTestSuiteForCredentialConfig` by inlining their logic
- **Enhanced schema service**: Updated to accept individual parameters (type, version, url) instead of config objects
- **Fixed library interface**: Updated `TestCredentialHandler` to use full `IConfigContent` instead of omitting `dataPath`
- **Added URL support**: Enhanced `processTestSuiteForCredential` to accept optional URL parameter
- **Fixed linting errors**: Removed unnecessary boolean type annotations in fileScanner.ts
- **Improved architecture**: Core functions now work with file paths directly, config functions are simple wrappers

### 2025-07-16 (Refactoring Complete)
- **REFACTORING COMPLETED** - Core functions now use file paths as primary input
- Implemented proper architecture with file paths as the fundamental API
- Core functions refactored:
  - `processTestSuite()` now takes file paths array as primary input
  - `processTestSuiteForCredential()` now takes file path as primary input
  - `processCheckDataBySchemaForFile()` works directly with file paths
- Config-based functions converted to wrapper functions:
  - `processTestSuiteForConfigs()` wraps the core file-based function
  - `processTestSuiteForConfigPath()` wraps the core file-based function
  - `processTestSuiteForCredentialConfig()` wraps the core file-based function
- Library interface updated to maintain backward compatibility
- All CLI functionality tested and working with new architecture

### 2025-07-16 (Initial Implementation)
- **INITIAL IMPLEMENTATION** - CLI interface working but needs refactoring
- **3.1 - CLI argument parsing**: Updated `/src/interfaces/cli/test.ts` to support:
  - Individual file arguments as variadic parameters
  - `-d` / `--directory` option for directory scanning
  - `-r` / `--recursive` option for recursive directory scanning
  - Maintained backward compatibility with existing `--config` option
- **3.2 - Directory scanning logic**: Created `/src/utils/fileScanner.ts` with:
  - `scanDirectoryForCredentials()` function for directory scanning
  - Smart filtering to skip non-credential files (ObjectEvent, config files, etc.)
  - Support for recursive scanning with `-r` flag
  - Proper error handling for invalid paths
- **3.3 - CLI command processing**: Added `processTestSuiteForFilePaths()` function to:
  - Process arrays of file paths directly
  - Convert file paths to credential configs internally
  - Integrate with existing test suite processing logic
- **3.4 - Documentation**: Updated README.md with comprehensive examples of:
  - Individual file testing: `untp test file1.json file2.json`
  - Directory scanning: `untp test -d ./credentials/`
  - Recursive scanning: `untp test -d ./credentials/ -r`
  - Mixed approach: `untp test -d ./credentials/ additional-file.json`
  - Legacy config file usage for backward compatibility
- **3.5 - Testing and validation**: Thoroughly tested all use cases:
  - Individual files: ✅ Working
  - Directory scanning: ✅ Working
  - Recursive scanning: ✅ Working
  - Mixed approach: ✅ Working
  - Backward compatibility: ✅ Working
  - Error handling: ✅ Working (invalid files, missing directories)
  - Default behavior: ✅ Working (falls back to credentials.json)

### 2025-07-15
- Task created based on the need to complete the API simplification
- Initial analysis and planning completed
- Ready to begin implementation after TASK001 completion

## Final Implementation Summary

The task has been successfully completed with proper architecture that truly eliminates config file dependency:

### Core Architecture:
1. **File Paths as Primary Input**: Core functions now work with file paths directly
2. **Config Functions as Wrappers**: Config-based functions are now wrapper functions
3. **Clean API Design**: The API is now more intuitive and truly file-based

### CLI Usage Patterns:
1. **Individual Files**: `untp test file1.json file2.json file3.json`
2. **Directory Scanning**: `untp test -d ./credentials/` (with optional `-r` for recursive)
3. **Mixed Approach**: `untp test -d ./credentials/ additional-file.json`
4. **Legacy Config Support**: `untp test -c ./credentials.json` (backward compatibility)

### Key Achievements:
- Eliminated config file dependency from core processing
- Maintained full backward compatibility for existing users
- Improved API design with file paths as the fundamental input
- Smart content-based file filtering using VerifiableCredential validation
- Extension-agnostic file processing (supports .json, .jsonld, etc.)
- Comprehensive error handling with helpful error messages
- Updated documentation with clear usage examples
- Cleaner codebase with reduced wrapper functions and improved architecture
- Proper URL support throughout the system for remote schema fetching

The untp-test-suite is now much more reusable and user-friendly, achieving the original project goal of simplifying the API for use in different interfaces while maintaining excellent code quality and architectural integrity.

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