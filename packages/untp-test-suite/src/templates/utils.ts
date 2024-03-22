import { ErrorObject } from 'ajv';
import {
  IValidatedCredentials,
  TemplateName,
  FinalStatus,
  ICredentialTestResult,
  IFinalReport,
  TestSuiteMessage,
} from '../core/types/index.js';

export const getTemplateName = (testSuiteResult: IValidatedCredentials): string => {
  // If there are no errors, return 'pass'
  if (!testSuiteResult.errors || !testSuiteResult.errors.length) {
    return TemplateName.pass;
  }

  const errors = testSuiteResult.errors as ErrorObject[];
  const isWarningType = errors.find((error) => error?.params?.additionalProperty);
  if (isWarningType) {
    // If any ErrorObject has 'additionalProperty', return 'warning'
    return TemplateName.warn;
  }

  // If no ErrorObject has 'additionalProperty', return 'FAIL'
  return TemplateName.error;
};

export const generateFinalMessage = (credentials: ICredentialTestResult[]): IFinalReport => {
  let finalMessage = TestSuiteMessage.Pass;
  let finalStatus: FinalStatus = FinalStatus.pass;

  if (credentials.some((credential) => credential.result === FinalStatus.warn)) {
    finalMessage = TestSuiteMessage.Warning;
    finalStatus = FinalStatus.warn;
  }

  if (credentials.some((credential) => credential.result === FinalStatus.fail)) {
    finalMessage = TestSuiteMessage.Fail;
    finalStatus = FinalStatus.fail;
  }

  return {
    finalStatus,
    finalMessage,
  };
};
