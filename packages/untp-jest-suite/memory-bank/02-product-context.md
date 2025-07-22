# Product Context

## Current Problem

The existing [UNTP Test Suite](../../untp-test-suite) package implements Tier 1 and Tier 2 validation but is not reusable or extensible. It also implements its own test runner and reporting infrastructure rather than leveraging existing test frameworks. As a result, the [UNTP Playground](../../untp-playground) web application re-implements the same validation logic instead of reusing the existing package.

This duplication of effort leads to:
- Inconsistent validation behavior across UNTP tools
- Wasted development effort maintaining multiple implementations
- Custom test infrastructure instead of leveraging proven test runners like Mocha

## Proposed Solution for a proof-of-concept

Create a Mocha-based, reusable library that provides UNTP credential validation for both CLI and browser usage, enabling tools like UNTP Playground to share the same validation logic. The CLI can be a wrapper around Mocha's Node.js API, while web applications can run the same tests directly in the browser using Mocha's browser build.

See the [active context for the currently active work](./03-active-context.md).
