/**
 * UNTP Mocha Runner - Executes Mocha tests for UNTP credential validation
 */

import Mocha from 'mocha';
import * as path from 'path';
import { UNTPTestOptions } from './types';
import { StreamReporter, StreamEvent } from './stream-reporter';

export interface UNTPTestResults {
  success: boolean;
  stats: {
    suites: number;
    tests: number;
    passes: number;
    pending: number;
    failures: number;
    duration: number;
  };
}

/**
 * Executes Mocha tests for UNTP credential validation
 *
 * This class provides programmatic access to run UNTP validation tests
 * in both Node.js and browser environments using a custom streaming reporter.
 */
export class UNTPMochaRunner {
  /**
   * Run Mocha tests against UNTP credentials with streaming results
   *
   * Uses custom reporter to provide real-time test results that are
   * streamed to the onStream callback as they happen.
   * Works in both Node.js and browser environments.
   */
  async run(options: UNTPTestOptions, onStream?: (event: StreamEvent) => void): Promise<UNTPTestResults> {
    return new Promise((resolve, reject) => {
      try {
        // Create Mocha instance with custom streaming reporter and grep support
        const mochaOptions: any = {
          reporter: StreamReporter as any,
          timeout: 5000,
          bail: false,
          reporterOptions: {
            onStream: onStream,
          },
        };

        // Add tag filtering using grep if specified
        if (options.tags && options.tags.length > 0) {
          const tagPattern = options.tags.map((tag) => `\\btag:${tag}\\b`).join('|');
          mochaOptions.grep = tagPattern;
        }

        const mocha = new Mocha(mochaOptions);

        // Add test files from the untp-tests directory
        // In Node.js, use path.join. In browser, tests would be pre-loaded
        if (typeof (globalThis as any).window === 'undefined') {
          // Node.js environment
          const testsDir = path.join(__dirname, '../untp-tests');
          mocha.addFile(path.join(testsDir, 'tier1/dummy.test.js'));

          // If additional tests directory is specified, add those tests too
          if (options.additionalTestsDir) {
            // TODO: Implement additional test directory scanning
            console.log(`Would scan additional tests in: ${options.additionalTestsDir}`);
          }
        } else {
          // Browser environment - tests would need to be pre-loaded via script tags
          // or bundled. For now, assume they're already available globally
          console.log('Browser environment: tests should be pre-loaded');
        }

        // Track results for final summary
        const results: UNTPTestResults = {
          success: false,
          stats: {
            suites: 0,
            tests: 0,
            passes: 0,
            pending: 0,
            failures: 0,
            duration: 0,
          },
        };

        // Run the tests
        const runner = mocha.run((failures) => {
          results.success = failures === 0;
          resolve(results);
        });

        // Update results from runner stats at the end
        runner.on('end', () => {
          if (runner.stats) {
            results.stats = {
              suites: runner.stats.suites || 0,
              tests: runner.stats.tests || 0,
              passes: runner.stats.passes || 0,
              pending: runner.stats.pending || 0,
              failures: runner.stats.failures || 0,
              duration: runner.stats.duration || 0,
            };
          }
        });

        runner.on('error', (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}
