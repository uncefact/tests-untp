import module from 'module';
import { Command } from 'commander';
import { test } from './test.js';
import { config } from './config.js';

const requireCjs = module.createRequire(import.meta.url);
const { version } = requireCjs('../../../package.json');

const untp = new Command('untp')
  .version(version, '-v, --version')
  .addCommand(test)
  .addCommand(config);

export { untp };
