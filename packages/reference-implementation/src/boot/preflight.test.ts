/**
 * @jest-environment node
 */
import { writeBootFailureAndExit } from './preflight';

type TestStderr = NonNullable<Parameters<typeof writeBootFailureAndExit>[1]>;

it('waits for a successful asynchronous stderr write before exiting 1', async () => {
  const events: string[] = [];
  const stderr: TestStderr = {
    write: jest.fn((_message, callback) => {
      events.push('write');
      setTimeout(() => {
        events.push('callback');
        callback();
      }, 0);
      return true;
    }),
  };
  const exit = jest.fn((code: number) => {
    events.push(`exit ${code}`);
    return undefined as never;
  });

  await writeBootFailureAndExit('boot failed\n', stderr, exit);

  expect(events).toEqual(['write', 'callback', 'exit 1']);
});

it('exits 1 when the stderr write callback reports an error', async () => {
  const stderr: TestStderr = {
    write: jest.fn((_message, callback) => {
      callback(new Error('stderr unavailable'));
      return true;
    }),
  };
  const exit = jest.fn(() => undefined as never);

  await writeBootFailureAndExit('boot failed\n', stderr, exit);

  expect(exit).toHaveBeenCalledWith(1);
});
