import { ErrorObject } from 'ajv';
import {
  IValidatedCredentials,
  TestSuiteResultEnum,
  ICredentialTestResult,
  IFinalReport,
  TestSuiteMessage,
  TemplateEnum,
} from '../core/types/index.js';
import { templateMapper } from './mapper.js';

export const getTemplates = (validatedCredential: IValidatedCredentials): TemplateEnum[] => {
  const errors = validatedCredential.errors as ErrorObject[];

  // Pass template
  const isPassTemplate = !errors?.length;
  if (isPassTemplate) {
    return [TemplateEnum.CREDENTIAL_RESULT];
  }
  
  // Error or Error and warning template
  return errors.reduce((validationResult, current) => {
    const template = current.params?.additionalProperty ? TemplateEnum.WARNINGS : TemplateEnum.ERRORS;
    validationResult.push(template);

    return validationResult;
  }, [TemplateEnum.CREDENTIAL_RESULT] as TemplateEnum[]);
};

export const getCredentialResults = async (validatedCredentials: IValidatedCredentials[]): Promise<ICredentialTestResult[]> => {
  const credentialsResultPromises = validatedCredentials.map(async (validatedCredential) => {
    const templates = getTemplates(validatedCredential);
    const result = getResult(templates);

    const totalErrors = validatedCredential.errors ? validatedCredential.errors as ErrorObject[] : [];
    const { errors, warnings } = totalErrors.reduce((validationResult, current) => {
      const key = current.params?.additionalProperty ? TemplateEnum.WARNINGS : TemplateEnum.ERRORS;
      validationResult[key].push(current);
      return validationResult;
    }, {
      errors: [] as ErrorObject[],
      warnings: [] as ErrorObject[]
    });

    const mappedCredentialPromises = templates.map(async (template) => {
      const templateData = { ...validatedCredential, result, errors, warnings };
      const credentialMessage = await templateMapper(template, templateData);
      return JSON.parse(credentialMessage);
    });

    const mappedCredentials = await Promise.all(mappedCredentialPromises);
    const credentialResult: ICredentialTestResult = mappedCredentials.reduce((result, current) => {

      return { ...result, ...current };
    }, {});

    return credentialResult;
  });

  const credentialResults = await Promise.all(credentialsResultPromises);
  return credentialResults;
};

export const getFinalReport = async (credentialResults: ICredentialTestResult[]): Promise<IFinalReport> => {
  const initFinalReport = { finalStatus: TestSuiteResultEnum.PASS, finalMessage: TestSuiteMessage.Pass } as IFinalReport;

  const finalReportTemplateData = credentialResults.reduce((acc, credential) => {
    if (credential.result === TestSuiteResultEnum.WARN && acc.finalStatus !== TestSuiteResultEnum.FAIL) {
      acc.finalMessage = TestSuiteMessage.Warning;
      acc.finalStatus = TestSuiteResultEnum.WARN;
    }

    if (credential.result === TestSuiteResultEnum.FAIL) {
      acc.finalMessage = TestSuiteMessage.Fail;
      acc.finalStatus = TestSuiteResultEnum.FAIL;
    }

    return acc;
  }, initFinalReport);

  const finalReportJson = await templateMapper(TemplateEnum.FINAL_REPORT, finalReportTemplateData);
  return JSON.parse(finalReportJson);
};

function getResult(templates: TemplateEnum[]) {
  const isPassType = templates.length === 1;
  if (isPassType) {
    return TestSuiteResultEnum.PASS;
  }

  const [, ...errorOrWarningTemplate] = templates;
  const isWarningType = errorOrWarningTemplate.every(template => template === TemplateEnum.WARNINGS);
  if (isWarningType) {
    return TestSuiteResultEnum.WARN;
  }

  return TestSuiteResultEnum.FAIL;
}