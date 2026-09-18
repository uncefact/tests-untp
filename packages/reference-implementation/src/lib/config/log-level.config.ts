export type ApplicationLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/** Reads the minimum level required for operator audit output. */
export function readLogLevel(env: Record<string, string | undefined> = process.env): ApplicationLogLevel {
  const value = env.LOG_LEVEL?.trim();
  if (
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'fatal' ||
    value === 'silent'
  ) {
    return value;
  }
  return 'info';
}
