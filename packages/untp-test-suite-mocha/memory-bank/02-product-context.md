The current situation is that tiers 1 and 2 tests have been implemented in a separate [UNTP Test Suite](../../untp-test-suite) package but not in a way that is re-usable, extensible or making the best use of existing test runners. It's for this reason that the parent [UNTP playground web UX package](../../untp-playground) is not re-using the existing untp-test-suite package, but rather re-implements the same tests for the web user experience. This is the cause of duplicated work and efforts.

There are many well-tested test runners out there such as jest, mocha, etc. which could potentially be useful here, rather than re-inventing an extensible test runner with configurable reporting etc.

See the [active context for the currently active work](./03-active-context.md).
