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

**Next Steps:**

📋 **TASK003 - Replace Config File with Individual File Arguments** (Pending - High Priority)
- Replace the credential config file on the CLI completely
- Allow individual files as arguments: `untp test file1.json file2.json`
- Add `-d` / `--directory` option for directory scanning: `untp test -d ./credentials/`
- Maintain backward compatibility with existing `--config` option

The remaining steps include:
- Remove the `url` property from the config file (and any tests that used this)
- Complete CLI refactor to support direct file arguments and directory scanning

At that point, the config file will be completely replaced with a simple list of file paths, achieving the goal of a more intuitive and reusable API.

Once the API has been updated, we will then look at improving the existing implementation of tier 1 and 2 tests, by comparing with both the similar tests in the [sibling UNTP playground](../../untp-playground) package as well as those in the [untp-graph-validation-cli POC](https://github.com/absoludity/untp-graph-validation-cli), before adding the tier 3 support based on the implementation in the `untp-graph-validation-cli` POC.
