import { Command } from 'commander';
import { test } from './test.js';
import { config } from './config.js';
import { getPackageVersion } from '../../utils/common.js';

const packageVersion = getPackageVersion();

const untp = new Command('untp').version(packageVersion, '-v, --version').addCommand(test).addCommand(config);

export { untp };
