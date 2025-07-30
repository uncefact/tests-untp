# [TASK006] - Persistent HTTP Cache for Schema and Context Fetching

**Status:** Pending
**Priority:** Medium
**Tags:** performance, caching, http, schemas, jsonld-contexts
**Added:** 2025-07-31
**Updated:** 2025-07-31

## Original Request
Implement persistent disk caching for HTTP requests to improve performance between test runs. Currently, browsers automatically cache schemas and JSON-LD contexts, making subsequent test runs fast, but Node.js re-fetches everything on each run.

## Thought Process
The UNTP test suite fetches schemas and JSON-LD contexts during validation, which creates a performance disparity between browser and Node.js environments:

### Current Behavior Analysis
- **Browser Environment**: Automatic HTTP caching makes subsequent runs fast
- **Node.js Environment**: Every test run re-fetches all resources from network
- **Existing Cache**: In-memory `schemaCache` only persists within single test execution
- **Impact**: Slow CI builds, poor developer experience with repeated test runs

### Performance Impact
- Schema fetching can add 2-5 seconds per test run
- Multiplied across CI builds and developer iterations
- Particularly painful in development workflows with frequent test runs
- Network failures cause test failures even when schemas haven't changed

### Technical Requirements
1. **Persistent Storage**: Cache survives between process runs
2. **HTTP Headers Respect**: Honor cache-control, expires, etag headers  
3. **Universal Compatibility**: Work in both CLI and programmatic usage
4. **Cache Management**: Ability to clear cache when needed
5. **Fallback Behavior**: Graceful degradation if cache fails
6. **Size Management**: Prevent unlimited cache growth

### Cache Strategy Options
1. **node-cache-manager**: Mature library with disk store plugins
2. **Custom File Cache**: Simple filesystem-based caching
3. **HTTP Cache Libraries**: Libraries that implement full HTTP caching semantics

### Design Considerations
- **Cache Location**: User-global (~/.untp-test/cache/) vs project-local (.untp-cache/)
- **Cache Keys**: URL-based with hash for collision avoidance
- **Cache Invalidation**: Time-based, size-based, manual clearing
- **Configuration**: Allow users to disable/configure cache behavior
- **Error Handling**: Network failures shouldn't break existing cache

## Implementation Plan
- Research and select appropriate caching library (node-cache-manager vs alternatives)
- Design cache architecture that integrates with existing fetch wrapper
- Implement persistent cache with proper HTTP semantics
- Add CLI options for cache management (--clear-cache, --no-cache)
- Add cache location configuration option
- Implement cache size limits and cleanup
- Add logging/debug info for cache hits/misses
- Test cache behavior with various HTTP response scenarios
- Document cache behavior and configuration options
- Measure and document performance improvements

## Progress Tracking

**Overall Status:** Not Started - 0%

### Task Metadata
- **Priority Level:** Medium - Significant performance improvement for developer experience
- **Tags:** performance, caching, http, schemas, jsonld-contexts
- **Dependencies:** None - can be implemented independently
- **Estimated Effort:** 2-3 days

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 6.1 | Research caching library options (node-cache-manager vs alternatives) | Not Started | 2025-07-31 | Evaluate disk cache plugins and HTTP semantics support |
| 6.2 | Design cache architecture and integration points | Not Started | 2025-07-31 | How to integrate with existing fetch wrapper in utils.ts |
| 6.3 | Implement persistent cache with HTTP semantics | Not Started | 2025-07-31 | Respect cache-control headers, etags, etc. |
| 6.4 | Add CLI cache management options | Not Started | 2025-07-31 | --clear-cache, --no-cache, cache location config |
| 6.5 | Implement cache size limits and cleanup | Not Started | 2025-07-31 | Prevent unlimited growth, LRU eviction |
| 6.6 | Add comprehensive testing and benchmarking | Not Started | 2025-07-31 | Test various scenarios, measure performance gains |
| 6.7 | Update documentation and usage examples | Not Started | 2025-07-31 | Document cache behavior, configuration, troubleshooting |

## Progress Log
### 2025-07-31
- Task created to address performance disparity between browser and Node.js environments
- Identified that node-fetch has no built-in caching unlike browser fetch
- Current in-memory cache only helps within single test execution
- Performance impact significant for CI and development workflows
- Plan to use persistent disk cache with proper HTTP semantics

## Success Criteria
- **Performance**: Subsequent test runs 50-80% faster when schemas already cached
- **HTTP Compliance**: Proper respect for cache-control, expires, etag headers
- **CLI Integration**: `untp-test --clear-cache` and `--no-cache` options work
- **Configuration**: Configurable cache location and size limits
- **Reliability**: Cache failures don't break tests, graceful fallback to network
- **Documentation**: Clear guidance on cache behavior and troubleshooting
- **Universal**: Works in both CLI and programmatic library usage

## Related Resources
- Current schema caching in `src/untp-test/utils.ts` (schemaCache Map)
- HTTP fetch implementation in `src/bin/untp-test.ts` (node-fetch polyfill)
- Browser caching behavior observed in browser-test environment

## Cache Library Research Notes

### node-cache-manager Options
- **node-cache-manager**: Core library with plugin architecture
- **node-cache-manager-fs-hash**: File system cache store using hashed keys
- **node-cache-manager-fs-binary**: Binary file system cache store
- **node-cache-manager-redis**: Redis backend (overkill for this use case)

### Alternative Approaches
- **axios**: Has built-in cache adapters (axios-cache-adapter)
- **undici**: Node.js's new HTTP client with potential cache support
- **Custom implementation**: Simple filesystem-based cache with HTTP header parsing

### Cache Location Considerations
- **User Global**: `~/.untp-test/cache/` - shared across all projects
- **Project Local**: `./.untp-cache/` - isolated per project
- **Configurable**: Allow users to choose via CLI option or config file
- **Default**: Lean toward user global for maximum cache reuse

### HTTP Semantics to Implement
- **Cache-Control**: max-age, no-cache, no-store directives
- **Expires**: Absolute expiration dates
- **ETag**: Entity tags for conditional requests
- **Last-Modified**: Timestamp-based conditional requests
- **Vary**: Headers that affect cache keys