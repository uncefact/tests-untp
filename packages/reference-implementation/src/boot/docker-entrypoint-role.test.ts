import { spawnSync } from 'node:child_process';
import path from 'node:path';

it('runs the entrypoint role and maintenance shell assertions from Jest', () => {
  const script = path.resolve(__dirname, '../../docker-entrypoint-role.test.sh');
  const result = spawnSync('sh', [script], { encoding: 'utf8' });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.signal).toBeNull();
});
