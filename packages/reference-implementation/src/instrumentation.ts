/**
 * Next.js instrumentation hook entry point.
 *
 * Next.js 15 fires `register()` once per process at startup, in both
 * the Node and Edge runtimes. The OpenTelemetry Node SDK only runs in
 * the Node runtime, so we guard on `NEXT_RUNTIME` and dynamic-import
 * the Node-side initialiser to keep its dependencies out of the Edge
 * bundle.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node');
  }
}
