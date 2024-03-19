import * as loggerUtils from '../../../src/interfaces/utils/logger';

jest.mock('chalk', () => ({
  yellow: jest.fn((text: string) => text),
  red: jest.fn((text: string) => text),
  green: jest.fn((text: string) => text),
  blue: {
    bold: jest.fn((text: string) => text),
  },
  bgGreen: {
    white: {
      bold: jest.fn((text: string) => text),
    },
  },
  bgRed: {
    white: {
      bold: jest.fn((text: string) => text),
    },
  },
}));

jest.mock(
  'cli-table3',
  () =>
    class {
      lines: object[] = [];
      constructor() {}

      push(item: any) {
        this.lines.push(item);
      }
      toString() {
        return JSON.stringify(this.lines);
      }
    },
);

jest.mock('../../../src/utils/common', () => ({
  getPackageVersion: () => '0.0.1',
}));

const errorTestSuite = {
  credentialType: 'aggregationEvent',
  version: 'v0.0.1',
  path: 'data/dataPath.json',
  result: 'FAIL',
  errors: [
    {
      fieldName: 'fooField',
      errorType: 'enum',
      allowedValues: ['object', 'aggregationEvent'],
      message: 'fooField must be equal to one of the allowed values',
    },
  ],
};
const passTestSuite = {
  credentialType: 'passPassport',
  version: 'v0.0.1',
  path: 'data/dataPath.json',
  result: 'PASS',
};
const warningTestSuite = {
  credentialType: 'warningPassport',
  version: 'v0.0.1',
  path: 'data/dataPath.json',
  result: 'WARN',
  warnings: [
    {
      fieldName: 'testField',
      message: 'This schema additionalFields',
    },
  ],
};
const testSuiteResult = {
  testSuiteResults: [errorTestSuite, passTestSuite, warningTestSuite],
  finalStatus: 'FAIL',
  finalMessage: 'Test suite failed with 2 errors and 1 warning.',
};

describe('getLogStatus', () => {
  it('Should return combined message with Pass, Error, and Warning statuses', () => {
    const resultMessage = loggerUtils.getLogStatus(testSuiteResult.testSuiteResults);

    expect(resultMessage).toEqual(
      `Testing Credential: aggregationEvent
Version: v0.0.1
Path: data/dataPath.json
Status: FAIL
Error: fooField must be equal to one of the allowed values. Allowed values: object, aggregationEvent.
---
Testing Credential: passPassport
Version: v0.0.1
Path: data/dataPath.json
Status: PASS
---
Testing Credential: warningPassport
Version: v0.0.1
Path: data/dataPath.json
Status: WARN
Warning: This schema additionalFields.
---
`,
    );
  });

  it('should throw an error when the testSuiteResult have an invalid result', () => {
    try {
      const invalidTestSuiteResults = [{ result: 'invalid' }];

      loggerUtils.getLogStatus(invalidTestSuiteResults);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('colorMap[result] is not a function');
    }
  });
});

describe('getFinalReport', () => {
  it('Should return a table message with Pass, Error, and Warning statuses', () => {
    const testSuiteResultMock = {...testSuiteResult, testSuiteResults: [errorTestSuite]};
    const finalReport = loggerUtils.getFinalReport(testSuiteResultMock);

    expect(finalReport).toEqual(
      JSON.stringify([
        [{ colSpan: 3, content: 'UNTP Core Test Suite', hAlign: 'center' }],
        [{ colSpan: 3, content: 'Runner version 0.0.1', hAlign: 'center' }],
        ['Credential Type', 'Version', 'Status'],
        ['aggregationEvent', 'v0.0.1', 'FAIL'],
        [
          {
            colSpan: 3,
            content: 'Test suite failed with 2 errors and 1 warning.',
            hAlign: 'center',
          },
        ],
      ]),
    );
  });

  it('Should return an empty string when the testSuiteResult does not have the testSuiteResults nested inside', () => {
    const notHaveTestSuiteResults = {};

    const finalReport = loggerUtils.getFinalReport(notHaveTestSuiteResults);

    expect(finalReport).toBe('');
  });

  it('Should throw an error when the testSuiteResults has invalid data', () => {
    try {
      jest.spyOn(loggerUtils, 'getMessageWithColorByResult').mockImplementationOnce((text, message) => message);
      const invalidTestSuiteResult = {
        testSuiteResults: {
          length: 'invalid data',
        },
      };
      loggerUtils.getFinalReport(invalidTestSuiteResult);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('testSuiteResults.map is not a function');
    }
  });
});
