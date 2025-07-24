#!/usr/bin/env node

/**
 * UNTP Test CLI - Mocha wrapper for UNTP credential validation
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { UNTPTestRunner } from '../validator';
import { StreamEvent } from '../stream-reporter';
import { setCredentialData } from '../credential-state';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

// Track which test suite we're currently in
let currentSuite: string | null = null;

function handleStreamEvent(event: StreamEvent): void {
  switch (event.type) {
    case 'start':
      console.log('\nRunning UNTP validation tests...\n');
      break;

    case 'pass':
      // Print suite title if this is the first test in a new suite
      const suiteTitle = event.data.fullTitle.replace(` ${event.data.title}`, '');
      if (currentSuite !== suiteTitle) {
        currentSuite = suiteTitle;
        console.log(`  ${chalk.bold(suiteTitle)}`);
      }

      // Print passing test
      const testDuration = event.data.duration ? ` ${chalk.gray(`(${event.data.duration}ms)`)}` : '';
      console.log(`    ${chalk.green('✔')} ${chalk.gray(event.data.title)}${testDuration}`);
      break;

    case 'fail':
      // Print suite title if this is the first test in a new suite
      const failSuiteTitle = event.data.fullTitle.replace(` ${event.data.title}`, '');
      if (currentSuite !== failSuiteTitle) {
        currentSuite = failSuiteTitle;
        console.log(`  ${chalk.bold(failSuiteTitle)}`);
      }

      // Print failing test
      console.log(`    ${chalk.red('✖')} ${event.data.title}`);
      if (event.data.err && event.data.err.message) {
        console.log(`      ${chalk.red(event.data.err.message)}`);
      }
      break;

    case 'pending':
      // Print suite title if this is the first test in a new suite
      const pendingSuiteTitle = event.data.fullTitle.replace(` ${event.data.title}`, '');
      if (currentSuite !== pendingSuiteTitle) {
        currentSuite = pendingSuiteTitle;
        console.log(`  ${chalk.bold(pendingSuiteTitle)}`);
      }

      // Print pending test
      console.log(`    ${chalk.cyan('-')} ${event.data.title}`);
      break;

    case 'end':
      console.log(''); // Empty line before summary

      // Print summary
      const stats = event.data;
      const totalDuration = stats.duration ? `${stats.duration}ms` : '0ms';

      if (stats.passes > 0) {
        console.log(`  ${chalk.green(`${stats.passes} passing`)} ${chalk.gray(`(${totalDuration})`)}`);
      }

      if (stats.failures > 0) {
        console.log(`  ${chalk.red(`${stats.failures} failing`)}`);
      }

      if (stats.pending > 0) {
        console.log(`  ${chalk.cyan(`${stats.pending} pending`)}`);
      }

      console.log(''); // Empty line after summary
      break;
  }
}

program
  .name('untp-test')
  .description('UNTP credential validation using Mocha')
  .version('0.1.0')
  .option('-d, --directory <dir>', 'add files from directory to the test list')
  .option(
    '-t, --tag <tag>',
    'run only tests with this tag (can be used multiple times)',
    (value: string, previous: string[]) => {
      return previous ? previous.concat([value]) : [value];
    },
  )
  .arguments('[files...]')
  .action(async (files: string[], options: any) => {
    const allFiles = [...files]; // Start with provided file paths

    if (options.directory) {
      console.log(`Adding credential files from directory: ${options.directory}`);
      // TODO: Scan directory and add files to allFiles array
      allFiles.push(`${options.directory}/*`); // Placeholder - will implement scanning later
    }

    if (allFiles.length === 0) {
      console.error('No files specified. Provide file paths or use --directory option.');
      process.exit(1);
    }

    console.log(`Testing credential files: ${allFiles.join(', ')}`);

    try {
      // Read credential files directly and populate credential state
      const credentialData = new Map<string, string>();

      for (const filePath of allFiles) {
        try {
          const stats = await fs.promises.stat(filePath);

          if (!stats.isFile()) {
            console.warn(`Skipping ${filePath}: not a file`);
            continue;
          }

          const content = await fs.promises.readFile(filePath, 'utf8');
          const fileName = path.basename(filePath);

          // Validate JSON format
          JSON.parse(content);

          credentialData.set(fileName, content);
        } catch (error) {
          console.warn(`Skipping invalid JSON file ${filePath}:`, error);
        }
      }

      if (credentialData.size === 0) {
        console.error('No valid JSON credential files found');
        process.exit(1);
      }

      // Set credential data for tests
      setCredentialData(credentialData);

      // Use UNTPTestRunner with streaming callback
      const runner = new UNTPTestRunner();
      const results = await runner.run(
        {
          tags: options.tag,
          mochaSetupCallback: (mochaOptions) => {
            // Create Mocha instance with Node.js import
            const Mocha = require('mocha');
            const mocha = new Mocha(mochaOptions);

            // Set up test helpers globally before adding test files
            require('../test-helpers');

            // Add test files from the untp-tests directory
            const testsDir = path.join(__dirname, '../../untp-tests');
            mocha.addFile(path.join(testsDir, 'tier1/dummy.test.js'));

            // If additional tests directory is specified, add those tests too
            if (options.additionalTestsDir) {
              // TODO: Implement additional test directory scanning
              console.log(`Would scan additional tests in: ${options.additionalTestsDir}`);
            }

            return mocha;
          },
        },
        handleStreamEvent,
      );

      // Exit with appropriate code based on test results
      process.exit(results.success ? 0 : 1);
    } catch (error) {
      console.error('Test execution failed:', error);
      process.exit(1);
    }
  });

program.parse();
