# [TASK006] - Persistent HTTP Cache for JSON-LD Context Fetching

**Status:** Pending
**Priority:** Medium
**Tags:** performance, caching, http, schemas, jsonld-contexts
**Added:** 2025-07-31
**Updated:** 2025-07-31

## Original Request
Implement persistent disk caching for JSON-LD context fetching to improve performance between test runs. Schema caching already works effectively (1ms response times), but JSON-LD context fetching still hits the network every time, causing slower test runs.

## Thought Process
The UNTP test suite fetches JSON-LD contexts during Tier 1 validation, which creates a performance disparity between browser and Node.js environments:

### Current Behavior Analysis
- **Browser Environment**: Automatic HTTP caching makes subsequent runs fast
- **Node.js Environment**: JSON-LD contexts re-fetched on every test run
- **Schema Caching**: Already working effectively (1ms response times after first fetch)
- **JSON-LD Context Caching**: Missing - contexts fetched fresh every run
- **Impact**: Slower Tier 1 JSON-LD validation tests, especially in CI and development

### Performance Impact
- JSON-LD context fetching adds 500-1000ms per unique context per test run
- Multiple credentials may reference the same contexts repeatedly
- Multiplied across CI builds and developer iterations
- Network failures cause JSON-LD validation failures even when contexts haven't changed
- Schema validation is already fast due to existing caching

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
- Research JSON-LD context caching approaches (separate from existing schema cache)
- Design cache architecture for JSON-LD library integration
- Implement persistent cache for context URLs with proper HTTP semantics
- Add CLI options for cache management (--clear-jsonld-cache, --no-jsonld-cache)
- Add cache location configuration option
- Implement cache size limits and cleanup
- Add logging/debug info for context cache hits/misses
- Test cache behavior with various JSON-LD context scenarios
- Document JSON-LD caching behavior and configuration options
- Measure and document performance improvements for Tier 1 tests

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
| 6.1 | Research JSON-LD context caching approaches | Not Started | 2025-07-31 | How to cache contexts for JSON-LD library vs schema cache |
| 6.2 | Design cache architecture for JSON-LD integration | Not Started | 2025-07-31 | How to integrate with JSON-LD context loading |
| 6.3 | Implement persistent JSON-LD context cache | Not Started | 2025-07-31 | Respect cache-control headers, etags, etc. |
| 6.4 | Add CLI JSON-LD cache management options | Not Started | 2025-07-31 | --clear-jsonld-cache, --no-jsonld-cache, cache location config |
| 6.5 | Implement cache size limits and cleanup | Not Started | 2025-07-31 | Prevent unlimited growth, LRU eviction |
| 6.6 | Add comprehensive testing and benchmarking | Not Started | 2025-07-31 | Test various JSON-LD scenarios, measure Tier 1 performance gains |
| 6.7 | Update documentation and usage examples | Not Started | 2025-07-31 | Document JSON-LD cache behavior, configuration, troubleshooting |

## Progress Log
### 2025-07-31
- Task created to address performance disparity between browser and Node.js environments
- Discovered that schema caching already works effectively (1ms response times)
- JSON-LD context fetching is the actual performance bottleneck
- Current schema cache in utils.ts works well, but JSON-LD contexts always hit network
- Focus shifted to JSON-LD context caching specifically
- Plan to use persistent disk cache for JSON-LD contexts with proper HTTP semantics

## Success Criteria
- **Performance**: Subsequent test runs 50-80% faster when JSON-LD contexts already cached
- **HTTP Compliance**: Proper respect for cache-control, expires, etag headers
- **CLI Integration**: `untp-test --clear-cache` and `--no-cache` options work
- **Configuration**: Configurable cache location and size limits
- **Reliability**: Cache failures don't break tests, graceful fallback to network
- **Documentation**: Clear guidance on cache behavior and troubleshooting
- **Universal**: Works in both CLI and programmatic library usage

## Related Resources
- Current schema caching in `src/untp-test/utils.ts` (schemaCache Map) - already working well
- JSON-LD context fetching in Tier 1 validation - needs caching
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
- **User Global**: `~/.untp-test/jsonld-cache/` - shared across all projects
- **Project Local**: `./.untp-jsonld-cache/` - isolated per project
- **Configurable**: Allow users to choose via CLI option or config file
- **Default**: Lean toward user global for maximum JSON-LD context reuse

### HTTP Semantics to Implement
- **Cache-Control**: max-age, no-cache, no-store directives
- **Expires**: Absolute expiration dates
- **ETag**: Entity tags for conditional requests
- **Last-Modified**: Timestamp-based conditional requests
- **Vary**: Headers that affect cache keys