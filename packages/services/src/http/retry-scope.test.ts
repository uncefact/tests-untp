/**
 * @jest-environment node
 */
import { isRequestRetrySuppressed, runWithoutRequestRetry } from './retry-scope';
import { runWithRequestContext } from '../logging/request-context';

describe('runWithoutRequestRetry', () => {
  it('is off outside the scope', () => {
    expect(isRequestRetrySuppressed()).toBe(false);
  });

  it('switches request retry off for the callback and returns its result', () => {
    expect(runWithoutRequestRetry(() => isRequestRetrySuppressed())).toBe(true);
    expect(isRequestRetrySuppressed()).toBe(false);
  });

  it('stays on across awaits and under a nested request context', async () => {
    const seen = await runWithoutRequestRetry(async () => {
      await Promise.resolve();
      return runWithRequestContext('nested', async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return isRequestRetrySuppressed();
      });
    });
    expect(seen).toBe(true);
  });

  it('does not reach work running concurrently outside the scope', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inside = runWithoutRequestRetry(async () => {
      await gate;
      return isRequestRetrySuppressed();
    });
    const outside = (async () => {
      await Promise.resolve();
      const value = isRequestRetrySuppressed();
      release();
      return value;
    })();
    await expect(Promise.all([inside, outside])).resolves.toEqual([true, false]);
  });

  it('ends suppression for the rest of the scope once the callback resumes retry', async () => {
    // Regression: retry staying off after a batch item dispatches, which leaves a refused issue, store or publish unresent.
    const seen = await runWithoutRequestRetry(async (resumeRequestRetry) => {
      const before = isRequestRetrySuppressed();
      resumeRequestRetry();
      await new Promise((resolve) => setImmediate(resolve));
      return [before, isRequestRetrySuppressed()];
    });
    expect(seen).toEqual([true, false]);
  });

  it('keeps a resume made under a nested request context, and a later nested context does not restore suppression', async () => {
    // Regression: a nested request context switching suppression back on, or a resume made inside it not reaching the rest of the item.
    const seen = await runWithoutRequestRetry(async (resumeRequestRetry) => {
      const inNestedBefore = await runWithRequestContext('nested-before', async () => {
        await Promise.resolve();
        return isRequestRetrySuppressed();
      });
      await runWithRequestContext('nested-resume', async () => {
        await Promise.resolve();
        resumeRequestRetry();
      });
      const afterNested = isRequestRetrySuppressed();
      const inNestedAfter = await runWithRequestContext('nested-after', async () => isRequestRetrySuppressed());
      return [inNestedBefore, afterNested, inNestedAfter];
    });
    expect(seen).toEqual([true, false, false]);
  });

  it('starts every scope suppressed, whatever an earlier scope did', async () => {
    // Regression: resume state shared across scopes, so the next batch item starts with retry already on.
    await runWithoutRequestRetry(async (resumeRequestRetry) => resumeRequestRetry());
    await expect(runWithoutRequestRetry(async () => isRequestRetrySuppressed())).resolves.toBe(true);
  });

  it('resumes only its own scope: a nested scope starts suppressed, and resuming it leaves the outer scope as it was', () => {
    const seen = runWithoutRequestRetry((resumeOuter) => {
      const nested = runWithoutRequestRetry((resumeInner) => {
        resumeInner();
        return isRequestRetrySuppressed();
      });
      const outerAfterInnerResume = isRequestRetrySuppressed();
      resumeOuter();
      const nestedAfterOuterResume = runWithoutRequestRetry(() => isRequestRetrySuppressed());
      return [nested, outerAfterInnerResume, nestedAfterOuterResume];
    });
    expect(seen).toEqual([false, true, true]);
  });

  it('does not end a concurrent scope when another scope resumes, and never reaches work outside', async () => {
    // Regression: a global flag, where one item's dispatch would switch retry on for every item and for work outside.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = runWithoutRequestRetry(async () => {
      await gate;
      return isRequestRetrySuppressed();
    });
    const resuming = runWithoutRequestRetry(async (resumeRequestRetry) => {
      await Promise.resolve();
      resumeRequestRetry();
      const value = isRequestRetrySuppressed();
      release();
      return value;
    });
    await expect(Promise.all([waiting, resuming])).resolves.toEqual([true, false]);
    expect(isRequestRetrySuppressed()).toBe(false);
  });

  it('resumes its own scope when the handle is called from outside the callback', async () => {
    // Regression: a resume that works only inside the scope's async context, so an adapter calling onDispatch from
    // a callback that lost that context would leave a batch item's issue, store and publish unresent.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let handle!: () => void;
    const inside = runWithoutRequestRetry(async (resumeRequestRetry) => {
      handle = resumeRequestRetry;
      const before = isRequestRetrySuppressed();
      await gate;
      return [before, isRequestRetrySuppressed()];
    });
    handle();
    expect(isRequestRetrySuppressed()).toBe(false);
    release();
    await expect(inside).resolves.toEqual([true, false]);
  });
});
