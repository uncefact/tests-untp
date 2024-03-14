import { Command } from 'commander';
import { defaultCredentialFilePath, testSuiteHandler } from '../lib/index.js';

const test = new Command('test');
test
  .description('Run Untp test suites')
  .option('-c, --config <path>', `Configuration file (default path: "${defaultCredentialFilePath}")`, defaultCredentialFilePath)
  .action(async (options) => {
    await testSuiteHandler(options);
  });

export { test };
