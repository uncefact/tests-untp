import { Command } from 'commander';
import chalk from 'chalk';

// TODO: Change this variable to a constant file for reusable purposes
const defaultConfigFilePath = './src/config/credentials.json';

const log = console.log;
const test = new Command('test');
test
  .description('Run Untp test suites')
  .option('-c, --config <path>', `Configuration file (default path: "${defaultConfigFilePath}")`, defaultConfigFilePath)
  .action((options) => {
    try {
      log(chalk.yellow('Untp test suites are running......'));

      // Call the function to run test suites...
      let configPath = defaultConfigFilePath;
      const { config: customConfigPath } = options;
      if (customConfigPath) {
        configPath = customConfigPath;
      }
      // const configFileJson = await fs.promises.readFile(configPath, { encoding: 'utf-8' });
      // const configFileArray: { type: string, version: string, dataPath: string }[] = JSON.parse(configFileJson);
      //TODO: Call the core function....


      log(chalk.bgGreen.white.bold('Untp test suites have completed successfully!'));
    } catch (error) {
      log(chalk.bgRed.white.bold('Run Untp test suites failed'));
      log(chalk.red(error));
    }
  });

export { test };
