
The current situation is that the tiers 1 and 2 tests present in this package are not very re-usable, requiring a config file to be created first describing the files to be tested with redundant information about the version and type of credential. This can work for a CLI (even though it is a bit awkward) but for a web UX, for example, would require parsing uploaded files first to generate a config file before running tests.

It's for this reason that the parent [UNTP playground web UX package](../../untp-playground) is not re-using this untp-test-suite package, but rather re-implements the same tests for the web user experience. This is the cause of duplicated work and efforts.

See the [active context for the currently active work](./03-active-context.md).
