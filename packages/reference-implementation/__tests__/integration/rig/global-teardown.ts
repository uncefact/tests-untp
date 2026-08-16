import { removeContainer } from './docker';

/**
 * Jest globalTeardown: removes the ephemeral container this run started.
 * Runs in the same parent process as globalSetup, so the state handoff is a
 * plain global. An externally supplied database is left as-is (the operator
 * owns it); a crashed run's orphaned container is removed by the next run's
 * setup via the container label.
 */
export default async function globalTeardown(): Promise<void> {
  const state = (globalThis as Record<string, unknown>).__RI_INTEGRATION_RIG__ as
    | { containerId: string | null }
    | undefined;
  if (state?.containerId) {
    removeContainer(state.containerId);
  }
}
