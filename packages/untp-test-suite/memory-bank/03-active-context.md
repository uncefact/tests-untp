The current work underway aims to:
1. ensure it is re-usable with a simple API for both CLI and web and other user experiences (perhaps mobile later) by refactoring to support a list of file paths as the test API, and
2. once the above is complete, update the package to include the tier 3 testing which is currently only present in the [untp-graph-validation-cli POC](https://github.com/absoludity/untp-graph-validation-cli)

Note that the [untp-graph-validation-cli POC](https://github.com/absoludity/untp-graph-validation-cli) also includes the tier 1 and 2 with the desired list-of-file-paths API, so could also be used for comparison for the tier 1 and 2 tests, in addition to the tier 3 tests.

## Active work

The refactor to support a list of file-paths as an API (rather than the current config file) should be done in small, reviewable steps, focused on replacing the config file with a simple list of file paths.

The first small step towards the goal of removing the config file was already done in the [pull request](https://github.com/uncefact/tests-untp/pull/307) which removes the dependence on the `type` property of the config file. You can see those changes in this current branch by checking the output of `git diff next..HEAD`, but note that this PR has not yet been merged into main as it's not yet reviewed. The next steps in this new branch (which was created from the PR branch) would be along the lines of:
- Remove the dependence on the `version` property of the config file - the version can be inferred from the UNTP specific context to which the credential points,
- Remove the `url` property from the config file (and any tests that used this).

At that point, the config file is just listing file paths and so should be trivial to replace with a simple list of file paths.

Once the API has been updated, we will then look at improving the existing implementation of tier 1 and 2 tests, by comparing with both the similar tests in the [sibling UNTP playground](../../untp-playground) package as well as those in the [untp-graph-validation-cli POC](https://github.com/absoludity/untp-graph-validation-cli), before adding the tier 3 support based on the implementation in the `untp-graph-validation-cli` POC.
