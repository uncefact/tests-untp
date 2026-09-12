import { describeBootError } from './boot/describe-boot-error';

/**
 * Next.js instrumentation hook entry point.
 *
 * Next.js 15 fires `register()` once per process at startup, in both
 * the Node and Edge runtimes, and does not start serving requests until
 * the returned promise settles. Encryption key validation and the
 * OpenTelemetry Node SDK only run in the Node runtime, so we guard on
 * `NEXT_RUNTIME` and dynamic-import the Node-side initialiser to keep
 * its dependencies out of the Edge bundle.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { registerNode } = await import('./instrumentation.node');
      await registerNode();
    } catch (error: unknown) {
      try {
        await reportNodeBootFailure(error);
      } finally {
        process.exit(1);
      }
    }
  }
}

async function reportNodeBootFailure(error: unknown): Promise<void> {
  try {
    const [{ apiLogger }, { safeError }] = await Promise.all([
      import('./lib/api/logger'),
      import('./lib/api/safe-error'),
    ]);
    const code =
      typeof error === 'object' && error !== null && 'code' in error && error.code !== undefined
        ? String(error.code)
        : undefined;
    apiLogger.error(
      { error: safeError(error), ...(code === undefined ? {} : { code }) },
      'Node instrumentation boot failed',
    );
  } catch {
    // Invalid LOG_REDACT_PATHS can prevent apiLogger from being constructed.
    // The original boot failure still has to reach stderr before exit.
    console.error(`Node instrumentation boot failed: ${describeBootError(error)}`);
  }
}
