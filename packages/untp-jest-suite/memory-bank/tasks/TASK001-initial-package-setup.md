# [TASK001] - Create Initial Package with untp-test CLI Wrapper

**Status:** In Progress
**Priority:** High
**Tags:** setup, cli, jest, infrastructure
**Added:** 2025-07-21
**Updated:** 2025-07-21

## Original Request
Create the initial package with a `untp-test` command that (1) wraps the jest execution of tests, (2) runs the tests against a user-provided directory of credentials (although we can provide an example directory).

## Thought Process
This foundational task establishes the basic package structure and CLI wrapper around Jest. Key considerations:

- **Jest as Production Dependency**: Since the CLI wraps Jest execution and users will run Jest through our package, Jest needs to be a regular dependency, not a devDependency
- **CLI Wrapper Approach**: The `untp-test` command should be a thin wrapper that configures and executes Jest with UNTP-specific settings
- **Credential Directory Input**: Users provide a directory path containing credentials to test
- **Example Credentials**: Include sample credentials for testing and demonstration purposes

## Implementation Plan
- Set up basic Node.js/TypeScript package structure
- Configure Jest as a production dependency
- Create `untp-test` CLI command that wraps Jest
- Implement credential directory scanning and Jest configuration
- Add example credentials directory for testing
- Set up basic TypeScript build configuration
- Add initial package.json with proper dependencies

## Progress Tracking

**Overall Status:** In Progress - 0%

### Task Metadata
- **Priority Level:** High - Foundation for entire project
- **Tags:** setup, cli, jest, infrastructure
- **Dependencies:** None
- **Estimated Effort:** 1-2 days

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 1.1 | Initialize package.json and TypeScript config | Not Started | 2025-07-21 | Include Jest as production dependency |
| 1.2 | Create basic CLI entry point (bin/untp-test) | Not Started | 2025-07-21 | Wrapper around Jest execution |
| 1.3 | Implement credential directory scanning logic | Not Started | 2025-07-21 | Accept user-provided directory path |
| 1.4 | Configure Jest programmatically for UNTP testing | Not Started | 2025-07-21 | Dynamic Jest configuration |
| 1.5 | Create example credentials directory | Not Started | 2025-07-21 | Sample files for testing |
| 1.6 | Set up TypeScript build process | Not Started | 2025-07-21 | Compile to JavaScript for distribution |
| 1.7 | Test CLI wrapper functionality | Not Started | 2025-07-21 | Verify Jest execution works |

## Progress Log
### 2025-07-21
- Task created and added to project backlog
- Identified Jest dependency consideration (production vs dev)
- Outlined basic implementation approach