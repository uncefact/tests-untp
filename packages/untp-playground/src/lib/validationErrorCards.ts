import { acceptedArtefactFamilies } from '@/lib/credentialService';
import { type ArtefactStepFailure } from '@/lib/artefactFailure';
import { formatValidationError, readablePath } from '@/lib/formatValidationErrors';
import type { ValidationError } from '@/types';

export interface MessageValidationError {
  message: string;
  pointer?: string;
  path?: string;
  tip?: string;
  generatedTip?: string;
  detail?: string;
  supportable?: boolean;
  relationRule?: true;
  failureCard?: true;
}

export type NormalisedValidationError = ValidationError | MessageValidationError;

export interface ValidationErrorCard {
  kind: 'issue' | 'warning';
  /** The message or messages shown in the drawer card, in their display order. */
  messages: string[];
  /** The first message, exposed for report consumers that need one primary value. */
  message: string;
  /** A readable field path, when the drawer shows one. */
  path?: string;
  /** The selected remediation shown by the drawer. */
  tip?: string;
  /** The readable keyword chip shown by the drawer for validator errors. */
  keyword?: string;
  /** The raw errors used by the drawer for expansion and copy controls. */
  errors: NormalisedValidationError[];
  detail?: string;
  supportable?: boolean;
  isFailure?: boolean;
}

export interface ValidationErrorCards {
  issues: ValidationErrorCard[];
  warnings: ValidationErrorCard[];
}

const AJV_KEYWORDS = new Set([
  '$ref',
  'additionalItems',
  'additionalProperties',
  'allOf',
  'anyOf',
  'contains',
  'const',
  'dependencies',
  'dependentRequired',
  'dependentSchemas',
  'else',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'if',
  'items',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'not',
  'oneOf',
  'pattern',
  'patternProperties',
  'properties',
  'propertyNames',
  'required',
  'then',
  'type',
  'unevaluatedItems',
  'unevaluatedProperties',
  'uniqueItems',
  'false schema',
  'conflictingProperties',
  'jsonldService',
  'jsonldSyntax',
  'jsonldUrl',
  'jsonldValidation',
  'missingValue',
  'schema',
  'unknown',
  'unsupportedCredentialType',
]);

const JSON_LD_KEYWORDS = new Set(['jsonldUrl', 'jsonldSyntax', 'jsonldValidation', 'jsonldService']);

export const isJsonLdKeyword = (keyword: string): boolean => JSON_LD_KEYWORDS.has(keyword);

const READABLE_KEYWORDS: Record<string, string> = {
  const: 'incorrect value',
  enum: 'invalid option',
  required: 'missing field',
  type: 'wrong type',
  format: 'incorrect format',
  pattern: 'invalid format',
  minimum: 'too small',
  maximum: 'too large',
  minLength: 'too short',
  maxLength: 'too long',
  additionalProperties: 'unexpected field',
  missingValue: 'missing value',
  minItems: 'too few items',
  conflictingProperties: 'conflicting field',
  jsonldUrl: 'JSON-LD context URL',
  jsonldSyntax: 'JSON-LD syntax',
  jsonldValidation: 'JSON-LD validation',
  jsonldService: 'context service',
  unsupportedCredentialType: 'unsupported credential type',
  unknown: 'unknown error',
};

export const readableKeyword = (keyword: string): string => READABLE_KEYWORDS[keyword] || keyword;

export const isMessageValidationError = (error: unknown): error is MessageValidationError => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Record<string, unknown>;
  return typeof candidate.message === 'string' && typeof candidate.keyword !== 'string';
};

export const isValidatorError = (error: NormalisedValidationError): error is ValidationError =>
  !isMessageValidationError(error) && typeof error.keyword === 'string';

function getTipMessage(mainError: ValidationError): string | undefined {
  if (mainError.params?.solution) return mainError.params.solution;

  switch (mainError.keyword) {
    case 'const':
      return 'Update the value(s) to the correct one(s) or remove the field(s).';
    case 'enum':
      return 'Choose one of the values shown above.';
    case 'required':
      return `Add the missing "${mainError.params?.missingProperty ?? 'property'}" field.`;
    case 'type': {
      const expected = mainError.params?.type;
      const received = mainError.data;
      if (expected === 'array' && received !== undefined && !Array.isArray(received)) {
        return 'Wrap the existing value in an array, as shown above.';
      }
      if (expected === 'array') {
        return 'This field expects an array. Use square brackets, even if there is only one entry: ["value"].';
      }
      return `Change the value to match the expected type: ${expected ?? 'type'}.`;
    }
    case 'conflictingProperties':
      return 'Resolve the conflict by removing the conflicting field or updating it to a unique one.';
    case 'unsupportedCredentialType': {
      const supportedTypes = Array.isArray(mainError.params?.supportedTypes)
        ? mainError.params.supportedTypes.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      if (supportedTypes.length === 0) {
        return `Add the artefact on its own tab. The Playground accepts: ${acceptedArtefactFamilies().join(', ')}.`;
      }
      return `Add one of the supported UNTP credential types: ${supportedTypes.join(
        ', ',
      )}, or add the artefact on its own tab. The Playground accepts: ${acceptedArtefactFamilies().join(', ')}.`;
    }
    case 'jsonldValidation':
      return mainError.params?.code === 'invalid property'
        ? mainError.params?.property
          ? `Add "${mainError.params.property}" to a @context, or remove it from the credential.`
          : 'Add the property to a @context, or remove it from the credential.'
        : 'Report the JSON-LD diagnostic shown above.';
    case 'jsonldService':
    case 'jsonldSyntax':
    case 'jsonldUrl':
      return undefined;
    case 'unknown':
      return 'The JSON-LD library returned an error without a recognised category. The message above is the raw output.';
    default:
      return 'Make sure your input matches the required format.';
  }
}

export function errorTip(
  error: NormalisedValidationError,
  fallbackTip?: string,
  allowGeneratedTips = true,
): string | undefined {
  if (isMessageValidationError(error))
    return error.tip ?? (allowGeneratedTips ? error.generatedTip : undefined) ?? fallbackTip;
  const ownTip = (error as ValidationError & { tip?: string }).tip ?? error.params?.solution;
  if (ownTip) return ownTip;
  if (!allowGeneratedTips) return fallbackTip;
  return getTipMessage(error) ?? fallbackTip;
}

export function normaliseValidationError(error: unknown): NormalisedValidationError {
  if (isMessageValidationError(error)) return error;
  if (!error || typeof error !== 'object') {
    return { message: String(error), supportable: false };
  }

  const candidate = error as Record<string, unknown>;
  const validationError = error as ValidationError;
  const formatInput = {
    keyword: String(candidate.keyword ?? 'unknown'),
    instancePath: typeof candidate.instancePath === 'string' ? candidate.instancePath : '',
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
    params: validationError.params ?? {},
  };
  if (AJV_KEYWORDS.has(String(candidate.keyword))) {
    return {
      ...validationError,
      instancePath: formatInput.instancePath,
      message: typeof candidate.message === 'string' ? candidate.message : formatValidationError(formatInput),
    };
  }
  return {
    message: typeof validationError.message === 'string' ? validationError.message : formatValidationError(formatInput),
    ...(typeof validationError.instancePath === 'string' && validationError.instancePath
      ? { pointer: validationError.instancePath }
      : {}),
    ...((validationError as ValidationError & { tip?: string }).tip || validationError.params?.solution
      ? {
          tip: (validationError as ValidationError & { tip?: string }).tip ?? validationError.params?.solution,
        }
      : {}),
    generatedTip: getTipMessage(validationError),
  };
}

function failureError(failure: ArtefactStepFailure, duplicate?: MessageValidationError): MessageValidationError {
  return {
    message: failure.message,
    failureCard: true,
    ...(failure.artefactUrl ? { path: failure.artefactUrl } : {}),
    tip: duplicate?.tip ?? failure.remediation,
    ...(duplicate?.supportable ? { supportable: true } : {}),
    detail: [
      failure.serviceStatus === undefined ? undefined : `Service status: ${failure.serviceStatus}`,
      failure.upstreamStatus === undefined ? undefined : `Upstream status: ${failure.upstreamStatus}`,
    ]
      .filter((value): value is string => value !== undefined)
      .join('; '),
  };
}

function displayErrors(errors: unknown[], failure: ArtefactStepFailure | undefined): NormalisedValidationError[] {
  const normalisedErrors = errors.map(normaliseValidationError);
  if (!failure) return normalisedErrors;

  const duplicate = normalisedErrors.find(
    (error): error is MessageValidationError => isMessageValidationError(error) && error.message === failure.message,
  );
  const nonDuplicate = duplicate ? normalisedErrors.filter((error) => error !== duplicate) : normalisedErrors;
  const failureCard = failureError(failure, duplicate);
  const establishedFetchFailure = failure.class === 'could-not-fetch' || failure.class === 'unusable-artefact';
  const isMetaSchemaFailure = failure.code === 'schema.validation.meta-schema';

  if (establishedFetchFailure && !isMetaSchemaFailure) return [failureCard];
  if (nonDuplicate.length > 0) return [...(duplicate ? [failureCard] : []), ...nonDuplicate];
  return [failureCard];
}

function issueCard(
  errors: NormalisedValidationError[],
  failure: ArtefactStepFailure | undefined,
  metaSchemaUrl?: string,
): ValidationErrorCard {
  const mainError = errors[0];
  if (!mainError) throw new Error('Cannot build a validation card without an error');
  if (isMessageValidationError(mainError)) {
    const path = mainError.path ?? (mainError.pointer ? readablePath(mainError.pointer) : undefined);
    return {
      kind: 'issue',
      messages: [`Issue: ${mainError.message}`],
      message: `Issue: ${mainError.message}`,
      ...(path ? { path } : {}),
      ...(mainError.detail ? { detail: mainError.detail } : {}),
      ...(errorTip(mainError, failure?.remediation, !failure || failure.class === 'credential-invalid')
        ? { tip: errorTip(mainError, failure?.remediation, !failure || failure.class === 'credential-invalid') }
        : {}),
      ...(mainError.supportable ? { supportable: true } : {}),
      ...(mainError.failureCard ? { isFailure: true } : {}),
      errors,
    };
  }

  const allowGeneratedTips = !failure || failure.class === 'credential-invalid';
  const validatorErrors = errors.filter(isValidatorError);
  const mainValidatorError = validatorErrors[0];
  if (!mainValidatorError) throw new Error('Cannot build a validator card without a validator error');
  const messages = validatorErrors.map((error, index) => {
    const formatted = formatValidationError(error);
    const prefixesIssue =
      JSON_LD_KEYWORDS.has(error.keyword) ||
      error.keyword === 'missingValue' ||
      error.keyword === 'conflictingProperties';
    return index === 0 && prefixesIssue ? `Issue: ${formatted}` : formatted;
  });
  const tip = errorTip(mainValidatorError, failure?.remediation, allowGeneratedTips);
  const path = metaSchemaUrl || readablePath(mainValidatorError.instancePath);
  return {
    kind: 'issue',
    messages,
    message: messages[0],
    ...(path ? { path } : {}),
    ...(tip ? { tip } : {}),
    keyword: readableKeyword(mainValidatorError.keyword),
    errors,
  };
}

function warningCard(error: ValidationError): ValidationErrorCard {
  const property = error.params?.additionalProperty;
  const message = `Additional property: "${property}"`;
  return {
    kind: 'warning',
    messages: [message],
    message,
    keyword: readableKeyword(error.keyword),
    errors: [error],
  };
}

/**
 * Builds the issue and warning cards consumed by both the validation drawer and the HTML report.
 * The returned order matches the drawer: issue groups first, then additional-property warnings.
 */
export function buildValidationCards(rawErrors: unknown, failure?: ArtefactStepFailure): ValidationErrorCards {
  const errors = Array.isArray(rawErrors) ? rawErrors : [];
  const displayed = displayErrors(errors, failure);
  const isMetaSchemaFailure = failure?.code === 'schema.validation.meta-schema';
  const metaSchemaUrl = isMetaSchemaFailure ? failure?.artefactUrl : undefined;
  const messageErrors = displayed.filter(isMessageValidationError);
  const warnings = displayed.filter(
    (error): error is ValidationError => isValidatorError(error) && error.keyword === 'additionalProperties',
  );
  const validatorErrors = displayed.filter(
    (error): error is ValidationError => isValidatorError(error) && error.keyword !== 'additionalProperties',
  );

  const issues: ValidationErrorCard[] = messageErrors.map((error) => issueCard([error], failure, metaSchemaUrl));
  const groups = new Map<string, ValidationError[]>();
  for (const error of validatorErrors) {
    const basePath = error.instancePath.replace(/\/\d+$/, '');
    const group = groups.get(basePath) ?? [];
    group.push(error);
    groups.set(basePath, group);
  }
  for (const group of groups.values()) issues.push(issueCard(group, failure, metaSchemaUrl));

  return { issues, warnings: warnings.map(warningCard) };
}

export function validationCardsInDrawerOrder(cards: ValidationErrorCards): ValidationErrorCard[] {
  return [...cards.issues, ...cards.warnings];
}
