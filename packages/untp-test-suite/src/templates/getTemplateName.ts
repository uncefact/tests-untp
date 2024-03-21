import { ErrorObject } from 'ajv';
import { IValidatedCredentials, TemplateName } from '../core/types/index.js';

export const getTemplateName = (testSuiteResult: IValidatedCredentials): string => {
  if (testSuiteResult.errors === null) {
    return TemplateName.pass;
  }

  if (Array.isArray(testSuiteResult.errors) && testSuiteResult.errors.length > 0) {
    const errorObjects = testSuiteResult.errors as ErrorObject[];
    const errorWithAdditionalProperty = errorObjects.find((error) => error?.params?.additionalProperty);
    if (errorWithAdditionalProperty) {
      // If any ErrorObject has 'additionalProperty', return 'warning'
      return TemplateName.warn;
    }

    // If no ErrorObject has 'additionalProperty', return 'FAIL'
    return TemplateName.error;
  } else {
    return TemplateName.pass;
  }
};
