import { Command } from 'commander';
import { defaultConfigFilePath, processTestSuite } from '../lib/index.js';

const test = new Command('test');
test
  .description('Run Untp test suites')
  .option('-c, --config <path>', `Configuration file (default path: "${defaultConfigFilePath}")`, defaultConfigFilePath)
  .action(async (options) => {
    await processTestSuite(options);
  });

export { test };
