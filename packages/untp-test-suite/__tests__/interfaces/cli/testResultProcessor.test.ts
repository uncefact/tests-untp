import { TestSuiteMessageEnum, TestSuiteResultEnum } from '../../../src/core/types';
import * as testResultProcessor from '../../../src/interfaces/cli/testResultProcessor';

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
  truncateString: jest.fn((str: string, maxLength: number) => {
    if (str.length <= maxLength) {
      return str;
    }
    return `${str.slice(0, maxLength)}...`;
  }),
}));

const errorTestSuite = {
  credentialType: 'aggregationEvent',
  version: 'v0.0.1',
  path: 'data/dataPath.json',
  result: TestSuiteResultEnum.FAIL,
  errors: [
    {
      fieldName: 'test',
      errorType: 'enum',
      allowedValues: ['object', 'aggregationEvent'],
      message: 'test field must be equal to one of the allowed values',
    },
  ],
};
const passTestSuite = {
  credentialType: 'passPassport',
  version: 'v0.0.1',
  path: 'data/dataPath.json',
  result: TestSuiteResultEnum.PASS,
};
const warningTestSuite = {
  credentialType: 'warningPassport',
  version: 'v0.0.1',
  path: 'data/dataPath.json',
  result: TestSuiteResultEnum.WARN,
  warnings: [
    {
      fieldName: 'testField',
      message: 'This schema additionalFields',
    },
  ],
};
const errorAndWarningTestSuite = {
  credentialType: 'errorAndWarningTestSuite',
  version: 'v0.0.1',
  path: 'data/dataPath.json',
  result: TestSuiteResultEnum.FAIL,
  warnings: [
    {
      fieldName: 'testField',
      message: 'This schema additionalFields',
    },
  ],
  errors: [
    {
      fieldName: 'test',
      errorType: 'enum',
      allowedValues: ['object', 'aggregationEvent'],
      message: 'test field must be equal to one of the allowed values',
    },
  ],
};
const testSuiteResult = {
  credentials: [errorTestSuite, passTestSuite, warningTestSuite, errorAndWarningTestSuite],
  finalStatus: TestSuiteResultEnum.FAIL,
  finalMessage: TestSuiteMessageEnum.FAIL,
};

describe('getLogStatus', () => {
  it('Should return combined message with Pass, Error, and Warning statuses', () => {
    const resultMessage = testResultProcessor.getLogStatus(testSuiteResult.credentials);

    expect(resultMessage).toEqual(
      `Testing Credential: aggregationEvent
Version: v0.0.1
Path: data/dataPath.json
Result: FAIL
Error: 
test field must be equal to one of the allowed values
---
Testing Credential: passPassport
Version: v0.0.1
Path: data/dataPath.json
Result: PASS
---
Testing Credential: warningPassport
Version: v0.0.1
Path: data/dataPath.json
Result: WARN
Warning: 
This schema additionalFields
---
Testing Credential: errorAndWarningTestSuite
Version: v0.0.1
Path: data/dataPath.json
Result: FAIL
Warning: 
This schema additionalFields
Error: 
test field must be equal to one of the allowed values
---\n`,
    );
  });

  it('Should return message with PASS status', () => {
    const passCredentials = [passTestSuite];
    const resultMessage = testResultProcessor.getLogStatus(passCredentials);

    expect(resultMessage).toEqual(
      `Testing Credential: passPassport
Version: v0.0.1
Path: data/dataPath.json
Result: PASS
---\n`,
    );
  });

  it('Should return message with FAIL status', () => {
    const failCredentials = [errorTestSuite];
    const resultMessage = testResultProcessor.getLogStatus(failCredentials);

    expect(resultMessage).toEqual(
      `Testing Credential: aggregationEvent
Version: v0.0.1
Path: data/dataPath.json
Result: FAIL
Error: 
test field must be equal to one of the allowed values
---\n`,
    );
  });

  it('Should return message with WARN status', () => {
    const warningCredentials = [warningTestSuite];
    const resultMessage = testResultProcessor.getLogStatus(warningCredentials);

    expect(resultMessage).toEqual(
      `Testing Credential: warningPassport
Version: v0.0.1
Path: data/dataPath.json
Result: WARN
Warning: 
This schema additionalFields
---\n`,
    );
  });

  it('Should return message with warning and error, and status should be FAIL', () => {
    const errorAndWarningCredentials = [errorAndWarningTestSuite];
    const resultMessage = testResultProcessor.getLogStatus(errorAndWarningCredentials);

    expect(resultMessage).toEqual(
      `Testing Credential: errorAndWarningTestSuite
Version: v0.0.1
Path: data/dataPath.json
Result: FAIL
Warning: 
This schema additionalFields
Error: 
test field must be equal to one of the allowed values
---\n`,
    );
  });

  it('should throw an error when the testSuiteResult have an invalid result', () => {
    try {
      const invalidTestSuiteResults = [{ ...errorTestSuite, result: 'invalid' as TestSuiteResultEnum }];

      testResultProcessor.getLogStatus(invalidTestSuiteResults);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('colorMap[result] is not a function');
    }
  });
});

describe('getFinalReport', () => {
  it('Should return a table message with FAIL status', () => {
    const testSuiteResultMock = { ...testSuiteResult, credentials: [errorTestSuite] };
    const finalReport = testResultProcessor.getFinalReport(testSuiteResultMock);

    expect(finalReport).toEqual(
      JSON.stringify([
        [{ colSpan: 3, content: 'UNTP Core Test Suite', hAlign: 'center' }],
        [{ colSpan: 3, content: 'Runner version 0.0.1', hAlign: 'center' }],
        ['Credential Type', 'Version', 'URL', 'Status'],
        ['aggregationEvent', 'v0.0.1', '', 'FAIL'],
        [
          {
            colSpan: 3,
            content: 'Your credentials are not UNTP compliant',
            hAlign: 'center',
          },
        ],
      ]),
    );
  });

  it('Should return an empty string when the testSuiteResult does not have the credentialTestResults nested inside', () => {
    const notHaveCredentialTestResults = { ...testSuiteResult, credentials: [] };

    const finalReport = testResultProcessor.getFinalReport(notHaveCredentialTestResults);

    expect(finalReport).toBe('');
  });
});
