# TASK004 - Higher-Level Config and Multi-Schema Validation

**Status:** Pending
**Priority:** High
**Tags:** config, schema-validation, multi-tier-testing, extensibility
**Added:** 2025-07-16
**Updated:** 2025-07-16

## Original Request
Although we've removed the need for the credential config (config for each credential which included type, version and possibly a schema URL), we will still need some higher-level user config in some cases: When testing UNTP credentials, no extra config will be required, but when testing extensions of UNTP credentials, we'll need to allow the user to specify a map from credential type (and possibly version) to a schema URL. Also, as part of this, we'll want to ensure that we test not just one schema... for example, a DigitalProductPassport should pass both the VerifiableCredential schema as well as the UNTP-specific DigitalProductPassport schema, so that will involve some refactoring too. It will be a good chance to start splitting the tests into tier 1 and 2 tests.

## Thought Process
This task represents a significant architectural evolution of the test suite. We've successfully simplified the per-credential config, but now we need to introduce a higher-level configuration system that can handle:

1. **Extension support**: Allow users to specify custom schema mappings for credential types that extend UNTP
2. **Multi-schema validation**: Each credential should be validated against multiple schemas (e.g., VerifiableCredential + UNTP-specific schema)
3. **Tiered testing**: This is the perfect opportunity to implement the tier 1 and tier 2 testing architecture mentioned in the project brief

The key insight is that standard UNTP credentials should work without any config, but extensions need a way to specify where their schemas are located.

## Implementation Plan

### 1. Design Higher-Level Configuration System
- Create optional user config file (e.g., `extension-config.json`) to support mapping UNTP extension types to schemas (if they don't follow the same naming conventions).
- Define schema for mapping credential types to schema URLs
- Support version-specific mappings when needed
- Ensure config is optional - standard UNTP credentials work without it

### 2. Implement Multi-Schema Validation
- Refactor validation logic to test against multiple schemas per credential
- **Tier 1**: Valid JSON, valid JSON Linked Data, and W3C Verifiable Credential schema validation
- **Tier 2**: UNTP-specific schema validation (business logic)
- Handle validation results from multiple schemas appropriately

### 3. Update Schema Resolution Logic
- Modify `dynamicLoadingSchemaService` to handle multiple schemas
- Implement fallback logic: user config → built-in UNTP schemas → error
- Support both local and remote schema resolution

### 4. CLI and Library Interface Updates
- Add support for optional config file parameter
- Update CLI to accept `--config-file` for higher-level config
- Ensure backward compatibility with existing usage patterns

### 5. Implement Tiered Testing Architecture
- Split validation into distinct tiers as per project brief
- Tier 1: Valid JSON, valid JSON Linked Data, and W3C Verifiable Credential schema validation
- Tier 2: UNTP-specific business logic validation
- Prepare foundation for future Tier 3 (graph validation)

## Progress Tracking

**Overall Status:** Not Started - 0%

### Task Metadata
- **Priority Level:** High - Key architectural improvement for extensibility
- **Tags:** config, schema-validation, multi-tier-testing, extensibility
- **Dependencies:** TASK003 (Replace Config File with Individual File Arguments) - Completed
- **Estimated Effort:** 6-8 hours

### Subtasks
| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 4.1 | Design higher-level config system | Not Started | 2025-07-16 | Define schema mapping structure |
| 4.2 | Implement multi-schema validation | Not Started | 2025-07-16 | Support multiple schemas per credential |
| 4.3 | Update schema resolution logic | Not Started | 2025-07-16 | Handle user config + built-in schemas |
| 4.4 | Implement tiered testing architecture | Not Started | 2025-07-16 | Split into Tier 1 and Tier 2 tests |
| 4.5 | Update CLI and library interfaces | Not Started | 2025-07-16 | Add config file support |
| 4.6 | Test and validate changes | Not Started | 2025-07-16 | Ensure all use cases work |

## Progress Log
### 2025-07-16
- Task created to address the need for higher-level configuration and multi-schema validation
- Initial analysis and planning completed
- Ready to begin implementation after TASK003 completion

## Implementation Notes

### Example Higher-Level Config Structure
```json
{
  "schemaMapping": {
    "ExtendedProductPassport": {
      "v1.0.0": "https://example.com/schemas/extended-product-passport/v1.0.0.json"
    },
    "CustomCredential": {
      "*": "https://example.com/schemas/custom-credential/latest.json"
    }
  }
}
```

### Multi-Schema Validation Flow
1. **Tier 1**: Ensures each credential file is a valid VerifiableCredential (valid JSON, valid JSON Linked Data, and conforms to W3C Verifiable Credential schema)
2. **Tier 2**: Validate against UNTP-specific schema (auto-detected or from extension config)
3. **Result Aggregation**: Combine results from both tiers
4. **Reporting**: Show tier-specific results and overall status

### CLI Usage Examples
```bash
# Standard UNTP credentials (no config needed)
untp test file1.json file2.json

# With higher-level config for extensions
untp test --config-file ./extension-config.json file1.json file2.json

# Directory scanning with config
untp test --config-file ./extension-config.json -d ./credentials/
```

### Key Design Principles
- **Zero config for standard UNTP**: Standard credentials work without any configuration
- **Progressive enhancement**: Config only needed for extensions and advanced use cases
- **Backward compatibility**: All existing usage patterns continue to work
- **Clear separation**: Tier 1 and Tier 2 tests are distinct and reportable separately
- **Extensibility**: Easy to add new credential types and schemas

### Integration Points
- Build upon the file-based API established in TASK003
- Integrate with existing schema loading service
- Maintain all current CLI and library interfaces
- Prepare foundation for future Tier 3 graph validation

## Success Criteria
- [ ] Standard UNTP credentials work without any configuration
- [ ] Extensions can be configured via schema mapping
- [ ] Each credential validates against multiple schemas (Tier 1 + Tier 2)
- [ ] Clear separation between tier 1 and tier 2 test results
- [ ] Backward compatibility maintained
- [ ] Performance remains acceptable with multi-schema validation
- [ ] Documentation updated with new configuration options

This task will significantly enhance the extensibility of the test suite while maintaining the simplicity achieved in TASK003 for standard use cases.
