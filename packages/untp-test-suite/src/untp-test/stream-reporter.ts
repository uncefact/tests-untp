/**
 * Custom Mocha reporter that streams test events to a callback function
 * Works in both Node.js and browser environments.
 *
 * This is required because the json and json-stream reporters in mocha always
 * write to process.stdout, which doesn't exist in a browser.
 * See closed-as-not-planned [Feature: Allow passing in a "target object" for the JSON reporter](https://github.com/mochajs/mocha/issues/5111)
 * where writing a custom reporter is the suggested way forward.
 */

export interface StreamEvent {
  type: 'start' | 'pass' | 'fail' | 'pending' | 'end';
  data: any;
}

/**
 * Custom Mocha reporter that streams events to a callback function
 * Works in both Node.js and browser environments
 */
export class StreamReporter {
  private callback: ((event: StreamEvent) => void) | undefined;

  constructor(runner: any, options: any) {
    this.callback = options.reporterOptions?.onStream;

    runner.on('start', () => {
      if (this.callback) {
        this.callback({
          type: 'start',
          data: { total: runner.total },
        });
      }
    });

    runner.on('pass', (test: any) => {
      if (this.callback) {
        this.callback({
          type: 'pass',
          data: {
            title: test.title,
            fullTitle: test.fullTitle(),
            duration: test.duration,
            speed: test.speed,
            file: test.file,
            currentRetry: test.currentRetry,
            parent: test.parent,
            suiteHierarchy: this.getSuiteHierarchy(test),
          },
        });
      }
    });

    runner.on('fail', (test: any, err: any) => {
      if (this.callback) {
        this.callback({
          type: 'fail',
          data: {
            title: test.title,
            fullTitle: test.fullTitle(),
            duration: test.duration,
            file: test.file,
            currentRetry: test.currentRetry,
            parent: test.parent,
            suiteHierarchy: this.getSuiteHierarchy(test),
            err: {
              message: err.message,
              stack: err.stack,
            },
          },
        });
      }
    });

    runner.on('pending', (test: any) => {
      if (this.callback) {
        this.callback({
          type: 'pending',
          data: {
            title: test.title,
            fullTitle: test.fullTitle(),
            file: test.file,
            parent: test.parent,
            suiteHierarchy: this.getSuiteHierarchy(test),
          },
        });
      }
    });

    runner.on('end', () => {
      if (this.callback) {
        const stats = runner.stats || {};
        this.callback({
          type: 'end',
          data: {
            suites: stats.suites || 0,
            tests: stats.tests || 0,
            passes: stats.passes || 0,
            pending: stats.pending || 0,
            failures: stats.failures || 0,
            duration: stats.duration || 0,
            start: stats.start,
            end: stats.end,
          },
        });
      }
    });
  }

  /**
   * Extract suite hierarchy from Mocha test object
   * Returns array of suite titles from root to immediate parent
   */
  private getSuiteHierarchy(test: any): string[] {
    const hierarchy: string[] = [];
    let current = test.parent;

    while (current && current.title) {
      hierarchy.unshift(current.title);
      current = current.parent;
    }

    return hierarchy;
  }
}
