# TASK002 - Replace Pre-commit Hook with CI Task

**Status:** Pending
**Priority:** Low
**Tags:** developer-experience, ci, git, performance
**Added:** 2025-07-14
**Updated:** 2025-07-14

## Original Request
Remove the git pre-commit hook which makes a git commit take over 5 seconds. Instead we should replace it with a CI task that ensures the files are linted or whatever else it is doing and fails the check there. This will enable developers to either enable a pre-commit hook if that's their thing, or just run it themselves once before submitting a PR (or even have it run as a pre-check when using the gh CLI to create a PR).

## Thought Process
The current pre-commit hook is causing significant friction in the development workflow by adding 5+ seconds to every commit. This impacts developer productivity and creates a poor development experience. Moving these checks to CI maintains code quality while giving developers flexibility in how they want to handle pre-commit validation.

Benefits of this approach:
1. **Faster commits** - Removes the mandatory 5-second delay on every commit
2. **Developer choice** - Developers can opt-in to pre-commit hooks if they prefer
3. **Same quality standards** - CI will still catch issues before merging
4. **Better integration** - Can integrate with GitHub CLI for pre-PR checks
5. **Scalable** - CI can handle more complex/slower checks without impacting local development

## Implementation Plan
1. **Analyze current pre-commit hook**
   - Identify what the current hook is doing (linting, formatting, tests, etc.)
   - Document the specific tools and checks being run
   - Understand the performance bottlenecks

2. **Design CI replacement**
   - Create CI workflow that runs the same checks
   - Ensure it runs on PRs and relevant branches
   - Consider running checks only on changed files for performance

3. **Update development documentation**
   - Document the new workflow for developers
   - Provide instructions for optional local pre-commit setup
   - Include guidance on running checks before PR creation

4. **Implement CI workflow**
   - Create GitHub Actions workflow (or equivalent CI system)
   - Configure it to run on pull requests
   - Set up proper failure conditions and reporting

5. **Remove pre-commit hook**
   - Remove or disable the current pre-commit hook
   - Clean up any related configuration files
   - Update repository setup documentation

6. **Optional enhancements**
   - Investigate integration with `gh` CLI for pre-PR checks
   - Create optional pre-commit hook configuration for developers who want it
   - Consider adding commit-msg hooks for conventional commits if needed

## Progress Tracking

**Overall Status:** Not Started - 0%

### Task Metadata
- **Priority Level:** Low - Quality of life improvement, not blocking core functionality
- **Tags:** developer-experience, ci, git, performance
- **Dependencies:** None
- **Estimated Effort:** 2-3 hours

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 2.1 | Analyze current pre-commit hook implementation | Not Started | 2025-07-14 | Understand what checks are currently running |
| 2.2 | Design CI workflow replacement | Not Started | 2025-07-14 | Plan the CI implementation |
| 2.3 | Implement CI workflow | Not Started | 2025-07-14 | Create GitHub Actions or equivalent |
| 2.4 | Update development documentation | Not Started | 2025-07-14 | Guide developers on new workflow |
| 2.5 | Remove pre-commit hook | Not Started | 2025-07-14 | Clean up existing hook |
| 2.6 | Test and validate new workflow | Not Started | 2025-07-14 | Ensure CI catches issues properly |

## Progress Log
### 2025-07-14
- Task created based on developer experience feedback
- Initial analysis and planning completed
- Low priority due to being a quality-of-life improvement
- Ready to begin implementation when time permits