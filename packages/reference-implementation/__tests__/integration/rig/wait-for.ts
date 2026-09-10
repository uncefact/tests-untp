/** Polls a real integration store until it reaches the expected state. */
export async function waitFor<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  let value = await read();
  while (!matches(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  if (!matches(value)) throw new Error('Timed out waiting for the integration state to settle');
  return value;
}
