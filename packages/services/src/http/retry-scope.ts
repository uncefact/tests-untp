import { AsyncLocalStorage } from 'async_hooks';

/**
 * A store of its own rather than a field on the request context, because
 * `runWithRequestContext` replaces that store: a nested request context
 * inside the scope would otherwise switch request retry back on. The state
 * is one object per scope, held by reference, so a nested request context
 * neither ends suppression early nor restores it once the scope has resumed
 * retry.
 */
const suppression = new AsyncLocalStorage<{ suppressed: boolean }>();

/**
 * Runs the callback with request retry switched off until the callback calls
 * the `resumeRequestRetry` function it is given. An `httpFetch` call started
 * inside the scope before the resume, however deeply nested, makes one
 * attempt whatever its own `retry` option says. A call started after the
 * resume follows its own `retry` option. `httpFetch` reads suppression once,
 * when the call starts, so a request already in flight at the resume keeps
 * its one attempt.
 *
 * A caller that retries part of a unit of work itself uses this so the two
 * retries never multiply. The batch job suppresses retry in an item until
 * the item dispatches its credential request, because its item ladder
 * retries only the faults before that point (ADR-060).
 *
 * Each call has its own state, and its `resumeRequestRetry` ends suppression
 * for that scope only: a nested scope starts suppressed again, and resuming
 * it leaves the outer scope as it was. Work running concurrently outside the
 * callback is unaffected. Nothing ambient can resume a scope: only its own
 * handle does, and the handle resumes that scope wherever it is called, so
 * the caller decides where it goes. The batch job passes it only to the
 * item's `onDispatch`.
 */
export function runWithoutRequestRetry<R>(callback: (resumeRequestRetry: () => void) => R): R {
  const state = { suppressed: true };
  return suppression.run(state, () =>
    callback(() => {
      state.suppressed = false;
    }),
  );
}

/**
 * Whether the current call is inside {@link runWithoutRequestRetry} and that
 * scope has not resumed request retry.
 */
export function isRequestRetrySuppressed(): boolean {
  return suppression.getStore()?.suppressed === true;
}
