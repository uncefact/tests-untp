import { Command } from 'commander';
import { generateCredentialFileHandler, schemasPath, defaultCredentialFilePath } from '../lib/index.js';

const config = new Command('config');
config
  .description('Create Untp test suites configuration file')
  .action(async () => {
    await generateCredentialFileHandler(defaultCredentialFilePath, schemasPath);
  });

export { config }
