import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { processTestSuiteForConfigPath, processTestSuite } from '../../core/index.js';
import { getFinalReport, getLogStatus } from './testResultProcessor.js';
import { scanDirectoryForCredentials, expandDirectoryPaths } from '../../utils/fileScanner.js';

const credentialFileName = 'credentials.json';
const defaultCredentialFilePath = `${process.cwd()}/${credentialFileName}`;

const test = new Command('test');
test
  .description('Run Untp test suites')
  .option('-c, --config <path>', `Configuration file (default path: "${defaultCredentialFilePath}")`)
  .option('-d, --directory <path>', 'Directory to scan for credential files')
  .option('-r, --recursive', 'Recursively scan subdirectories when using --directory')
  .argument('[files...]', 'Individual credential files to test')
  .action(async (files, options) => {
    try {
      let testSuiteResult;

      // Determine which mode to use based on provided arguments
      if (options.config) {
        // Legacy config file mode
        const configPath = path.resolve(process.cwd(), options.config);
        testSuiteResult = await processTestSuiteForConfigPath(configPath);
      } else if (options.directory || files.length > 0) {
        // New file-based mode
        const filePaths: string[] = [];

        // Add individual files
        if (files.length > 0) {
          filePaths.push(...files.map((file: string) => path.resolve(process.cwd(), file)));
        }

        // Add files from directory
        if (options.directory) {
          const directoryPath = path.resolve(process.cwd(), options.directory);
          const directoryFiles = await scanDirectoryForCredentials(directoryPath, options.recursive || false);
          filePaths.push(...directoryFiles);
        }

        if (filePaths.length === 0) {
          throw new Error(
            'No credential files found. Please provide individual files or a directory with credential files.',
          );
        }

        testSuiteResult = await processTestSuite(filePaths);
      } else {
        // Default behavior - look for default config file
        const defaultConfigPath = path.resolve(process.cwd(), defaultCredentialFilePath);
        try {
          testSuiteResult = await processTestSuiteForConfigPath(defaultConfigPath);
        } catch (error) {
          throw new Error(
            `No configuration file found at ${defaultConfigPath} and no individual files or directory specified. Please provide credential files using one of the following methods:\n` +
              '  - Individual files: untp test file1.json file2.json\n' +
              '  - Directory: untp test -d ./credentials/\n' +
              '  - Config file: untp test -c ./credentials.json',
          );
        }
      }

      const testSuiteMessage = getLogStatus(testSuiteResult.credentials);
      const testSuiteFinalReport = getFinalReport(testSuiteResult);

      console.log(testSuiteMessage);
      console.log(testSuiteFinalReport);
    } catch (error) {
      console.log(chalk.bgRed.white.bold('Run Untp test suites failed'));
      console.log(chalk.red(error));
    }
  });

export { test };
