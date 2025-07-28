# Active Context

## Current State (2025-07-23)

### **Recently Completed**
- **Project Renamed**: `untp-jest-suite` → `untp-test-suite-mocha` to reflect Mocha adoption
- **Universal Compatibility Achieved**: Switched from Jest to Mocha for Node.js + browser support
- **Streaming Test Results**: Implemented custom `StreamReporter` for real-time test output
- **Tag Filtering**: Added `--tag` support with word boundary regex for precise test filtering
- **CLI Integration**: `UNTPMochaRunner` provides same API for both CLI and programmatic usage

### **Current Architecture**
- **UNTPMochaRunner**: Core test execution engine (universal Node.js/browser)
- **StreamReporter**: Custom Mocha reporter for real-time streaming results
- **CLI Wrapper**: Commander-based CLI using same runner as web applications
- **Tag System**: Grep-based filtering with `tag:tagname` format in test titles

### **Working Features**
```bash
# CLI tag filtering
untp-test --tag tier1 --tag smoke credentials.json

# Real-time streaming results
untp-test credentials/ --directory extensions/
```

## **Active Work**

### **TASK001 - Package Setup (80% Complete)**
- ✅ Core infrastructure, CLI, streaming, tag filtering
- ❌ **Remaining**: Subtask 1.3 - Directory scanning for `--directory` option

### **TASK002 - Browser Compatibility (Completed)**
- ✅ **Goal**: Verify same `UNTPMochaRunner` works in browsers with credential uploads
- ✅ **Key Feature**: Users upload credential files, test against built-in test suites with same API
- ✅ **Result**: Universal compatibility validated

### **TASK004 - Implement Tier Tests (In Progress)**
- **Current**: Subtask 4.1 - Research untp-graph-validation-cli codebase
- **Status**: Code reorganization completed, ready to analyze validation components
- **Priority**: High - Core functionality for UNTP validation

## **Technical Decisions Made**

### **Mocha Over Jest**
- **Reason**: Jest requires Node.js, can't run in browsers
- **Benefit**: Same tests run in CLI (Node.js) and web apps (browser)
- **Trade-off**: Lost Jest's ecosystem, gained universal compatibility

### **Streaming Architecture**
- **Pattern**: `UNTPMochaRunner.run(options, streamCallback)`
- **Benefit**: Real-time results, same API for CLI colors and web UI updates
- **Implementation**: Custom `StreamReporter` captures Mocha events

### **Tag System Design**
- **Format**: `tag:tagname` in test titles (e.g., `"should validate JSON tag:tier1 tag:validation"`)
- **Filtering**: Mocha's built-in `--grep` with word boundaries
- **Benefit**: Simple, visible tags without external dependencies

## **Next Priorities**

1. **Complete TASK004 Subtask 4.1**: Analyze untp-graph-validation-cli validation components
2. **Extract Validation Logic**: Implement real W3C VC and UNTP schema validation
3. **Complete TASK001**: Implement directory scanning for `--directory` option
4. **Extension Framework**: Design how extensions integrate with the tag system

## **Key Architecture Insights**

### **Universal API Pattern**
```javascript
// This exact code works in both Node.js CLI and browser:
const runner = new UNTPMochaRunner();
const results = await runner.run({
  credentialFilePaths: ['file1.json'],  // CLI: file paths, Browser: uploaded files
  tags: ['tier1', 'smoke']
}, (event) => {
  // CLI: format with colors, Browser: update DOM
  handleStreamingResult(event);
});
```

### **Extension Integration**
- **Core Tests**: Built into package (`untp-tests/tier1/`, etc.)
- **Additional Tests**: User-provided via `--directory` (CLI) - browser support to be considered later
- **Tag Compatibility**: Extensions use same `tag:name` format for filtering

## **Recent Insights**

### **Code Organization (2025-07-28)**
- **Structure Cleanup**: Reorganized files into clean `src/untp-test/` directory
- **Important Learning**: Should use `git mv` instead of file move tools to preserve git history
- **Clean Architecture**: Top-level files now focused on library user interface

### **Progress Update**
- **TASK002**: ✅ Browser compatibility proven
- **TASK004**: 🔄 Started - code reorganized, ready for validation logic

## **Success Metrics**

- ✅ **API Consistency**: Same runner interface everywhere
- ✅ **Real-time Results**: Streaming test output working
- ✅ **Tag Filtering**: Precise test selection working
- ✅ **Browser Compatibility**: Validated with credential file uploads
- ✅ **Code Organization**: Clean structure for library users
- 🔄 **Real Validation Logic**: Next major milestone
- 🔄 **UNTP Playground Integration**: Planned consumer of this library

The foundation is solid and browser compatibility is proven. Now implementing actual UNTP validation logic to replace dummy tests.