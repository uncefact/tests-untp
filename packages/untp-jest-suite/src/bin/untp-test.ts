#!/usr/bin/env node

/**
 * UNTP Test CLI - Mocha wrapper for UNTP credential validation
 */

import { Command } from 'commander';
import Mocha from 'mocha';
import * as path from 'path';

const program = new Command();

program
  .name('untp-test')
  .description('UNTP credential validation using Mocha')
  .version('0.1.0')
  .option('-d, --directory <dir>', 'add files from directory to the test list')
  .arguments('[files...]')
  .action(async (files: string[], options) => {
    const allFiles = [...files]; // Start with provided file paths

    if (options.directory) {
      console.log(`Adding files from directory: ${options.directory}`);
      // TODO: Scan directory and add files to allFiles array
      allFiles.push(`${options.directory}/*`); // Placeholder - will implement scanning later
    }

    if (allFiles.length === 0) {
      console.error('No files specified. Provide file paths or use --directory option.');
      process.exit(1);
    }

    console.log(`Testing credential files: ${allFiles.join(', ')}`);
    console.log('Running UNTP validation tests...\n');

    try {
      // Execute Mocha using its programmatic API
      const testsDir = path.join(__dirname, '../../untp-tests');

      // Create Mocha instance with configuration
      const mocha = new Mocha({
        reporter: 'spec', // Default console reporter
        timeout: 5000,
        color: true,
        bail: false,
      });

      // Add test files from the untp-tests directory
      // For now, we'll look for .js files in the tests directory
      const testPattern = path.join(testsDir, '**/*.test.js');
      mocha.addFile(path.join(testsDir, 'tier1/dummy.test.js')); // Temporary - will be replaced with glob

      // TODO: Use UNTPMochaRunner here instead of direct Mocha API
      // const runner = new UNTPMochaRunner();
      // const result = await runner.run({ credentialFilePaths: allFiles });

      // Run the tests
      const runner = mocha.run((failures) => {
        // Exit with appropriate code based on test results
        process.exit(failures ? 1 : 0);
      });

      // Optional: Add event listeners for more detailed output
      runner.on('start', () => {
        console.log('Starting UNTP credential validation tests...');
      });

      runner.on('end', () => {
        console.log('\nTest execution completed.');
      });
    } catch (error) {
      console.error('Test execution failed:', error);
      process.exit(1);
    }
  });

program.parse();
