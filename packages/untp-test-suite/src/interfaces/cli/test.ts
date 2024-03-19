import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { processTestSuite } from '../../core/index.js';
import { getFinalReport, getLogStatus } from '../utils/logger.js';

const credentialFileName = 'credentials.json';
const defaultCredentialFilePath = `${process.cwd()}/${credentialFileName}`;

const test = new Command('test');
test
  .description('Run Untp test suites')
  .option(
    '-c, --config <path>',
    `Configuration file (default path: "${defaultCredentialFilePath}")`,
    defaultCredentialFilePath,
  )
  .action( (options) => {
    try {
      let credentialPath = `${process.cwd()}/${credentialFileName}`;
      if (options.config) {
        credentialPath = path.resolve(process.cwd(), options.config);
      }

      // const testSuiteResults = await processTestSuite(credentialPath);

      // const testSuiteMessage = getLogStatus(testSuiteResult.testSuiteResults);
      // const testSuiteFinalReport = getFinalReport(testSuiteResult);

      // console.log(testSuiteMessage);
      // console.log(testSuiteFinalReport);
    } catch (error) {
      console.log(chalk.bgRed.white.bold('Run Untp test suites failed'));
      console.log(chalk.red(error));
    }
  });

export { test };
