import { describeBootError } from '../boot/describe-boot-error';

/** Formats the worker-owned framing for a boot failure. */
export function formatWorkerBootFailure(error: unknown): string {
  return `Worker boot failed: ${describeBootError(error)}`;
}
