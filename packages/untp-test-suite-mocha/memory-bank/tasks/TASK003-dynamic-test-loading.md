# [TASK003] - Dynamic Test Loading Architecture

**Status:** Completed
**Priority:** High
**Tags:** browser, architecture, mocha, dynamic-loading
**Added:** 2025-07-25
**Updated:** 2025-07-25

## Original Request
Implement browser test loading after credential upload instead of at bundle load time. Currently we rely on the browser loading the tests automatically when the bundle loads, but we want to load tests into Mocha only *after* credential files are uploaded.

## Thought Process
This task addresses a fundamental architectural difference between CLI and browser environments:

### Current Architecture Problem
- **CLI Flow**: Credentials loaded → Tests added to Mocha → Tests executed
- **Browser Flow**: Tests loaded with bundle → Credentials uploaded later → Tests executed

The browser currently loads tests at bundle load time (when the page loads), but credentials don't exist until the user uploads them. This creates timing issues and forces us to create tests that check for credentials at execution time rather than having per-credential test suites.

### Desired Architecture
We want the browser to work more like the CLI:
- **New Browser Flow**: Page loads → User uploads credentials → Tests dynamically loaded → Tests executed

### Key Benefits
1. **Per-credential test suites**: Can create individual describe blocks for each credential file
2. **Better test organization**: Each credential gets its own test suite with dedicated tests
3. **Cleaner test output**: Test results clearly organized by credential file
4. **Consistent architecture**: Browser and CLI work the same way
5. **Extension compatibility**: Easier to add extension tests dynamically

### Technical Challenges
1. **Bundle separation**: Tests currently bundled with browser-bundle.js need to be loaded separately
2. **Dynamic test registration**: Mocha needs to load test files after credential upload
3. **Test file management**: Need to manage which tests to load based on credential types
4. **Error handling**: Graceful fallbacks when test loading fails

## Implementation Plan
- Separate test files from the main browser bundle
- Create dynamic test loading mechanism in UNTPTestRunner
- Modify browser HTML to load tests after credential upload
- Update browser bundle build process to exclude test files
- Implement test file serving mechanism (static files or dynamic generation)
- Update mochaSetupCallback to add tests dynamically instead of using pre-loaded tests
- Test the new architecture with multiple credential files
- Ensure backward compatibility with existing CLI behavior

## Progress Tracking

**Overall Status:** Completed - 100%

### Task Metadata
- **Priority Level:** High - Required for proper per-credential test organization
- **Tags:** browser, architecture, mocha, dynamic-loading
- **Dependencies:** TASK002 (completed - browser compatibility verified)
- **Estimated Effort:** 2-3 days

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 3.1 | Analyze current test loading mechanism | Complete | 2025-07-25 | Tests imported in browser-bundle.ts, executed at bundle load time |
| 3.2 | Design dynamic test loading architecture | Complete | 2025-07-25 | registerUNTPTestSuite approach - defer test registration until after credentials |
| 3.3 | Separate test files from browser bundle | Complete | 2025-07-25 | Removed imports, added copy to build process, updated .gitignore |
| 3.4 | Implement registerUNTPTestSuite deferred registration | Complete | 2025-07-25 | Created test suite registry and execution functions |
| 3.5 | Update CLI to use registerUNTPTestSuite | Complete | 2025-07-25 | CLI now executes registered test suites after credentials loaded |
| 3.6 | Create per-credential test suite generation | Complete | 2025-07-25 | Test files now create nested describe blocks for each credential |
| 3.7 | Test multi-credential scenarios | Complete | 2025-07-25 | Verified multiple credentials create separate test suites |
| 3.8 | Update browser to use registerUNTPTestSuite | Complete | 2025-07-25 | Browser implementation working with fresh Mocha instances |

## Progress Log
### 2025-07-25
- Task created to address fundamental architectural issue
- Identified that browser needs to work more like CLI with post-upload test loading
- Current browser implementation loads tests at bundle time, causing timing issues
- Goal is to enable per-credential test suites like the original refactoring attempt
- Key insight: tests should be loaded dynamically after credentials are available
- **Status changed to In Progress** - Beginning work on dynamic test loading architecture
- **Completed subtask 3.1**: Analyzed current architecture:
  - Tests imported via `import '../untp-tests/tier1/dummy.test.js'` in browser-bundle.ts
  - Tests execute immediately when bundle loads (before credentials available)
  - Browser mochaSetupCallback only configures Mocha, doesn't add test files
  - CLI loads tests via `mocha.addFile()` in mochaSetupCallback after credentials set
  - Current tests use runtime credential checking instead of per-credential test suites
- **Completed subtask 3.2**: Designed registerUNTPTestSuite architecture:
  - **Key Insight**: Wrap test suites in registerUNTPTestSuite() to defer registration
  - **New Flow**: Test files load → register test suites → credentials loaded → execute registered suites
  - **Universal Pattern**: Same approach works for both CLI and browser
- **Completed subtask 3.3**: Separated test files from browser bundle:
  - Removed test import from browser-bundle.ts
  - Added copy command to build:browser script
  - Updated .gitignore to ignore browser-test/untp-tests/
  - Test files now available as separate files in browser-test directory
- **Completed subtask 3.4**: Implemented registerUNTPTestSuite system:
  - Added registerUNTPTestSuite() and executeRegisteredTestSuites() to test-helpers
  - Test files now wrap describe blocks in registerUNTPTestSuite()
  - Registry stores test suite functions for later execution
- **Completed subtask 3.5**: Updated CLI to use deferred registration:
  - CLI requires test files directly instead of using mocha.addFile()
  - Set up Mocha BDD interface with mocha.suite.emit('pre-require', global, null, mocha)
  - Execute registered test suites after credentials loaded and BDD available
- **Completed subtask 3.6**: Achieved per-credential test suites:
  - Test files now create nested describe blocks for each credential
  - Perfect test hierarchy: Main suite → per-credential suites → individual tests
- **Completed subtask 3.7**: Verified multi-credential scenarios:
  - CLI successfully creates separate describe blocks for each credential file
  - Clean test output with proper nesting and organization
- **Completed subtask 3.8**: Browser implementation working perfectly:
  - Fresh Mocha instances created for each test run (matches CLI pattern)
  - Per-credential test suites displaying correctly with proper hierarchy
  - Tag filtering working in browser environment
  - Multiple test runs handle credential changes correctly
- **TASK COMPLETED**: Successfully implemented dynamic test loading architecture:
  - ✅ Per-credential test suites with proper nesting
  - ✅ Universal CLI and browser compatibility
  - ✅ Proper tag display with clean formatting
  - ✅ Extensible architecture using Mocha's native hierarchy
  - ✅ Clean global namespace with untpTestSuite
  - ✅ Shared utility functions for maximum code reuse
  - ✅ Fresh Mocha instances prevent test pollution between runs