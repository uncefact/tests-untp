import { Command } from 'commander';
import chalk from 'chalk';
import { createConfigFile } from './createConfigFile.js';

const log = console.log;
const config = new Command('config');
config
  .description('Create Untp test suites configuration file')
  .action(async () => {
    try {
      await createConfigFile();

      // TODO: Change this variable to a constant file for reusable purposes
      const configFilePath = '/src/config/credentials.json';
      log(chalk.bgGreen.white.bold('Config file \'credentials.json\' created successfully!'));
      log(chalk.green(`The configuration file is located at: ${configFilePath}`));
    } catch (error) {
      log(chalk.red(error));
    }
  });

export { config }
