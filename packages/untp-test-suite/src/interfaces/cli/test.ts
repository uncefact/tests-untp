import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { processTestSuite } from '../../core/test-runner.js';
import { defaultConfigFilePath } from './config.js';

const log = console.log;
const test = new Command('test');
test
  .description('Run Untp test suites')
  .option('-c, --config <path>', `Configuration file (default path: "${defaultConfigFilePath}")`, defaultConfigFilePath)
  .action(async (options) => {
    try {
      log(chalk.yellow('Untp test suites are running......'));

      const configPath = options.config || defaultConfigFilePath;
      const fullConfigPath = path.resolve(process.cwd(), configPath);

      const testSuiteResults = await processTestSuite(fullConfigPath);
      const isHaveAnyError = testSuiteResults.some((testSuiteResult) => testSuiteResult.errors);
      isHaveAnyError
        ? log(chalk.bgRed.white.bold('The UNTP test suites have encountered failures!'))
        : log(chalk.bgGreen.white.bold('The UNTP test suites have completed successfully!'));

      console.log(testSuiteResults);
    } catch (error) {
      log(chalk.bgRed.white.bold('Run UNTP test suites failed'));
      log(chalk.red(error));
    }
  });

export { test };
