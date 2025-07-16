The current work underway aims to:
1. ensure it is re-usable with a simple API for both CLI and web and other user experiences (perhaps mobile later) by refactoring to support a list of file paths as the test API, and
2. once the above is complete, update the package to include the tier 3 testing which is currently only present in the [untp-graph-validation-cli POC](https://github.com/absoludity/untp-graph-validation-cli)

Note that the [untp-graph-validation-cli POC](https://github.com/absoludity/untp-graph-validation-cli) also includes the tier 1 and 2 with the desired list-of-file-paths API, so could also be used for comparison for the tier 1 and 2 tests, in addition to the tier 3 tests.

## Active work

The refactor to support a list of file-paths as an API (rather than the current config file) should be done in small, reviewable steps, focused on replacing the config file with a simple list of file paths.

**Progress Update:**

✅ **TASK001 - Remove Version Property Dependency** (Completed 2025-07-15)
- Successfully implemented version inference from credential @context field
- The version property is no longer required in the config file
- The system now automatically extracts version from URLs like `https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/`

✅ **TASK003 - Replace Config File with Individual File Arguments** (Completed 2025-07-16)
- Successfully refactored core functions to use file paths as primary input
- Implemented proper architecture where config-based functions are wrapper functions
- Core functions now work directly with file paths, eliminating config file dependency
- Implemented individual file arguments: `untp test file1.json file2.json`
- Added `-d` / `--directory` option for directory scanning: `untp test -d ./credentials/`
- Added `-r` / `--recursive` option for recursive directory scanning
- Maintained full backward compatibility with existing `--config` option
- Created smart content-based file filtering using VerifiableCredential validation
- Removed file extension restrictions (supports .json, .jsonld, etc.)
- Fixed misleading variable names and eliminated unnecessary wrapper functions
- Enhanced library interface to properly support URL-based schema fetching
- Updated documentation with comprehensive usage examples

**Next Steps:**

📋 **TASK004 - Higher-Level Config and Multi-Schema Validation** (Pending - High Priority)
- Implement optional user config for credential extensions and custom schema mappings
- Add multi-schema validation (Tier 1: VerifiableCredential + Tier 2: UNTP-specific schemas)
- Split testing into proper tiered architecture as outlined in project brief
- Support extensions while keeping standard UNTP credentials config-free

📋 **TASK005 - Update API Types for File-Path Based Interface** (Pending - Medium Priority)
- Update exposed API types in testSuiteHandler.ts to reflect new file-path based API
- Create clean, intuitive interfaces that match actual implementation
- Prepare for optional extension schema mapping integration from TASK004
- Remove confusing config-based signatures and improve TypeScript support

The remaining steps from previous work include:
- Remove the `url` property from the config file (and any tests that used this)

The CLI refactor has been completed successfully with proper architecture! The system now supports:
- **Core API**: File paths as primary input to all core functions with URL support
- **Individual file arguments**: `untp test file1.json file2.json`
- **Directory scanning**: `untp test -d ./credentials/`
- **Recursive scanning**: `untp test -d ./credentials/ -r`
- **Mixed approach**: `untp test -d ./credentials/ additional-file.json`
- **Legacy config file support**: Backward compatibility through wrapper functions
- **Content-based validation**: Smart filtering based on VerifiableCredential type
- **Extension-agnostic**: Supports .json, .jsonld, and other file extensions
- **Clean architecture**: Eliminated unnecessary wrapper functions and improved code quality

This achieves the goal of a more intuitive and reusable API that truly eliminates the config file dependency from core processing while maintaining full backward compatibility and excellent code quality.

Once the API has been updated, we will then look at improving the existing implementation of tier 1 and 2 tests, by comparing with both the similar tests in the [sibling UNTP playground](../../untp-playground) package as well as those in the [untp-graph-validation-cli POC](https://github.com/absoludity/untp-graph-validation-cli), before adding the tier 3 support based on the implementation in the `untp-graph-validation-cli` POC.
