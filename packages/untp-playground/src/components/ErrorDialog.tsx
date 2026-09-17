import { ValidationError } from '@/types';
import { formatValidationError } from '@/lib/formatValidationErrors';
import { describeArtefactFailure, type ArtefactFailureFamily, type ArtefactStepFailure } from '@/lib/artefactFailure';
import { acceptedArtefactFamilies } from '@/lib/credentialService';
import { AlertCircle, Check, ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';

interface ErrorDialogProps {
  errors: any[];
  failure?: ArtefactStepFailure;
  family?: ArtefactFailureFamily;
  className?: string;
}

const getReadableKeyword = (keyword: string) => {
  const keywords: { [key: string]: string } = {
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
  return keywords[keyword] || keyword;
};

const isJsonLdKeyword = (keyword: string) =>
  keyword === 'jsonldUrl' ||
  keyword === 'jsonldSyntax' ||
  keyword === 'jsonldValidation' ||
  keyword === 'jsonldService';

const jsType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

// `data` may contain BigInts or circular references (verbose AJV forwards the raw value), so
// JSON.stringify can throw. Wrap it so a malformed credential never crashes the dialog.
const safeStringify = (value: unknown, pretty = false): string => {
  try {
    return JSON.stringify(value, null, pretty ? 2 : undefined) ?? String(value);
  } catch {
    return String(value);
  }
};

// Build a small "did you mean this?" snippet for AJV type errors based on the actual received value.
// Only handles the common JSON-LD fix-up: wrapping a scalar in an array.
const correctiveExample = (mainError: { params?: Record<string, any>; data?: unknown }): string | null => {
  const expected = mainError.params?.type;
  const received = mainError.data;
  if (received === undefined) return null;
  if (expected === 'array' && !Array.isArray(received)) {
    return safeStringify([received], true);
  }
  if (expected === 'string' && typeof received !== 'string') {
    return safeStringify(String(received));
  }
  return null;
};

const errorHeaderText = (mainError: { keyword: string; params?: Record<string, any> }) => {
  return mainError.params?.code === 'invalid property' ? 'Property not defined in @context' : 'Diagnostic details';
};

const getFriendlyPath = (path: string) => {
  if (!path) return 'root';
  return path.replace(/^\//, '').replace(/\//g, ' → ');
};

const groupErrors = (errors: any[]) => {
  const warnings = errors.filter((error) => error.keyword === 'additionalProperties');
  const validationErrors = errors.filter((error) => error.keyword !== 'additionalProperties');

  const groups: { [key: string]: { path: string; errors: any[] } } = {};
  validationErrors.forEach((error) => {
    const basePath = error.instancePath.replace(/\/\d+$/, '');
    if (!groups[basePath]) {
      groups[basePath] = { path: basePath, errors: [] };
    }
    groups[basePath].errors.push(error);
  });

  return {
    issues: Object.values(groups),
    warnings: warnings.map((error) => ({
      path: error.params.additionalProperty,
      errors: [error],
    })),
  };
};

const getTipMessage = (mainError: ValidationError) => {
  if (mainError && mainError.params?.solution) {
    return mainError.params.solution;
  }

  switch (mainError.keyword) {
    case 'const':
      return 'Update the value(s) to the correct one(s) or remove the field(s).';
    case 'enum':
      return 'Choose one of the values shown above.';
    case 'required':
      return `Add the missing "${mainError?.params?.missingProperty ?? 'property'}" field.`;
    case 'type': {
      const expected = mainError?.params?.type;
      const received = mainError?.data;
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
    case 'unknown':
      return 'The JSON-LD library returned an error without a recognised category. The message above is the raw output.';
    default:
      return 'Make sure your input matches the required format.';
  }
};

interface ErrorDetailsProps {
  error: ValidationError;
  copied: boolean;
  onCopy: (text: string) => void;
  showCorrections: boolean;
  showTip: boolean;
}

const ErrorDetails: React.FC<ErrorDetailsProps> = ({ error, copied, onCopy, showCorrections, showTip }) => {
  const value = error.params?.allowedValue || error.params?.allowedValues;
  const fixExample = value ? safeStringify(value, true) : null;

  return (
    <div className='border-t border-gray-200 pt-4 first:border-t-0 first:pt-0'>
      {error.message && <p>Issue: {error.message}</p>}
      <br />
      {(() => {
        // For `required` errors AJV's `data` is the parent object, not the
        // missing field itself, so dumping it is noisy. The field line below
        // already names the offending property.
        if (error.keyword === 'required') return null;
        const received = error.params?.receivedValue !== undefined ? error.params.receivedValue : error.data;
        if (received === undefined) return null;
        return (
          <>
            <p>Received value ({jsType(received)}):</p>
            <br />
            <pre className='bg-white p-3 rounded border text-sm overflow-x-auto'>
              <code className='text-green-600 block py-4'>{safeStringify(received, true)}</code>
            </pre>
          </>
        );
      })()}
      <br />
      {showCorrections && error.keyword === 'const' && (
        <div className='flex flex-col gap-2'>
          <p>
            Incorrect value: <code className='px-1 py-0.5 bg-gray-100 rounded'>{error.instancePath}</code>
          </p>
        </div>
      )}
      {showCorrections && error.keyword === 'required' && (
        <p>
          Missing field: <code className='px-1 py-0.5 bg-gray-100 rounded'>{error.params?.missingProperty}</code>
        </p>
      )}
      {showCorrections && error.keyword === 'enum' && (
        <p>
          Must be one of:{' '}
          <code className='px-1 py-0.5 bg-gray-100 rounded'>{error.params?.allowedValues?.join(', ')}</code>
        </p>
      )}
      {showCorrections && error.keyword === 'type' && (
        <>
          <p>
            <b>Expected type: </b>
            <code className='px-1 py-0.5 bg-gray-100 rounded'>{error.params?.type}</code>
          </p>
          {(() => {
            const example = correctiveExample(error);
            return example ? (
              <div className='mt-2'>
                <p>Try this instead:</p>
                <pre className='bg-white p-3 rounded border text-sm overflow-x-auto mt-1'>
                  <code className='text-blue-700 block py-2'>{example}</code>
                </pre>
              </div>
            ) : null;
          })()}
        </>
      )}
      {showCorrections && error.keyword === 'missingValue' && <p>{error.message}</p>}
      {showCorrections && error.keyword === 'minItems' && (
        <p>
          Expected minimum number of items:{' '}
          <code className='px-1 py-0.5 bg-gray-100 rounded'>{error.params?.minItems}</code>
        </p>
      )}
      {showCorrections && error.keyword === 'conflictingProperties' && (
        <div className='flex flex-col gap-2'>
          <p>
            Conflicting field:{' '}
            <code className='px-1 py-0.5 bg-gray-100 rounded'>{error.params?.conflictingProperty}</code>
          </p>
        </div>
      )}
      {showCorrections && error.keyword === 'schema' && (
        <div className='flex flex-col gap-2'>
          <p>
            Error message:
            <code className='px-1 py-0.5 bg-gray-100 rounded'>{error.params?.missingValue}</code>
          </p>
        </div>
      )}
      {isJsonLdKeyword(error.keyword) && error.params?.code && (
        <p className='text-xs text-gray-500 mt-2'>
          JSON-LD code: <code className='px-1 py-0.5 bg-gray-100 rounded'>{error.params.code}</code>
        </p>
      )}

      {showCorrections && fixExample && (
        <div className='relative mt-2'>
          <p className='text-sm'>Example: </p>
          <pre className='bg-white p-3 rounded border text-sm overflow-x-auto'>
            <code className='text-green-600 block py-4'>{fixExample}</code>
          </pre>
          <button
            onClick={() => onCopy(fixExample)}
            className='absolute top-2 right-2 mb-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 bg-white px-2 py-1 rounded border'
          >
            {copied ? (
              <>
                <Check className='h-4 w-4' />
                Copied!
              </>
            ) : (
              <>
                <Copy className='h-4 w-4' />
                Copy
              </>
            )}
          </button>
        </div>
      )}

      {showTip && !(error.instancePath === '' && (error.keyword === 'false schema' || error.keyword === 'not')) && (
        <div className='mt-3 text-sm text-blue-800 bg-blue-50 p-3 rounded'>
          <strong>Tip: </strong>
          {getTipMessage(error)}
        </div>
      )}
    </div>
  );
};

export const ErrorDialog: React.FC<ErrorDialogProps> = ({
  errors = [],
  failure,
  family = 'credential',
  className = '',
}) => {
  const [expandedError, setExpandedError] = useState<number | null>(null);
  const [copiedError, setCopiedError] = useState<{ groupIndex: number; errorIndex: number } | null>(null);

  const handleCopy = (groupIndex: number, errorIndex: number, text: string) => {
    if (text) {
      navigator.clipboard.writeText(text);
      setCopiedError({ groupIndex, errorIndex });
      setTimeout(
        () =>
          setCopiedError((current) =>
            current?.groupIndex === groupIndex && current.errorIndex === errorIndex ? null : current,
          ),
        2000,
      );
    }
  };

  const presentation = describeArtefactFailure(failure, family);
  const establishedFetchFailure = failure?.class === 'could-not-fetch' || failure?.class === 'unusable-artefact';
  const displayErrors = establishedFetchFailure && failure?.code !== 'schema.validation.meta-schema' ? [] : errors;
  const canSuggestCredentialFixes = !presentation || failure?.class === 'credential-invalid';

  if (!Array.isArray(errors) || (errors.length === 0 && !presentation)) {
    return null;
  }

  const { issues, warnings } = groupErrors(displayErrors);
  const issueCount = issues.reduce((count, group) => count + group.errors.length, 0);
  const hasIssues = issues.length > 0;
  const hasWarnings = warnings.length > 0;

  return (
    <div className={className}>
      {presentation && (
        <div className='mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4' data-testid='artefact-failure-banner'>
          <div className='flex items-center gap-2'>
            <AlertCircle className='h-5 w-5 text-amber-500' />
            <h3 className='text-lg font-semibold'>{presentation.heading}</h3>
          </div>
          <p className='mt-2 text-sm text-gray-700'>{presentation.message}</p>
          <p className='mt-2 text-sm text-blue-800'>{presentation.remediation}</p>
        </div>
      )}
      {failure?.code === 'schema.validation.meta-schema' && displayErrors.length > 0 && (
        <p className='mb-4 text-sm text-gray-600'>These diagnostics describe the fetched schema, not the credential.</p>
      )}
      {hasIssues && (
        <>
          <div className='flex items-center gap-2 mb-4'>
            <AlertCircle className='h-5 w-5 text-amber-500' />
            <h3 className='text-lg font-semibold'>
              We Found {issueCount} {issueCount === 1 ? 'Issue' : 'Issues'}
            </h3>
          </div>

          <div className='space-y-4 mb-6'>
            {issues.map((group, index) => {
              const mainError = group.errors[0];
              const isExpanded = expandedError === index;
              const isAdditionalProp = mainError.keyword === 'additionalProperties';

              return (
                <div key={index} className='rounded-lg border bg-white'>
                  {isAdditionalProp ? (
                    <div className='p-4 flex items-start justify-between'>
                      <div className='flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            {`Additional property: "${mainError.params.additionalProperty}"`}
                          </span>
                          <span className='ml-2 text-xs px-2 py-1 rounded bg-blue-100 text-blue-700'>
                            {getReadableKeyword(mainError.keyword)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        className='w-full p-4 text-left flex items-start justify-between hover:bg-gray-50'
                        onClick={() => setExpandedError(isExpanded ? null : index)}
                      >
                        <div className='flex-1'>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm font-medium'>
                              {canSuggestCredentialFixes && mainError.keyword === 'const'
                                ? 'Use the correct value'
                                : canSuggestCredentialFixes && mainError.keyword === 'enum'
                                  ? 'Choose from allowed values'
                                  : presentation && failure?.class !== 'credential-invalid'
                                    ? 'Diagnostic details'
                                    : isJsonLdKeyword(mainError.keyword)
                                      ? errorHeaderText(mainError)
                                      : 'Fix validation error'}
                            </span>
                            <span
                              className={`ml-2 text-xs px-2 py-1 rounded ${
                                mainError.keyword === 'const'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {getReadableKeyword(mainError.keyword || 'unknown')}
                            </span>
                          </div>
                          {!isJsonLdKeyword(mainError.keyword) && (
                            <p className='text-sm text-gray-600 mt-1'>
                              Location: {getFriendlyPath(mainError.instancePath)}
                            </p>
                          )}
                          <div className='mt-2 space-y-1'>
                            {group.errors.map((error, errorIndex) => (
                              <p key={errorIndex} className='text-sm text-gray-600'>
                                {formatValidationError(error)}
                              </p>
                            ))}
                          </div>
                        </div>
                        <ChevronRight
                          className={`h-5 w-5 text-gray-400 transform transition-transform ${
                            isExpanded ? 'rotate-90' : ''
                          }`}
                        />
                      </button>

                      {isExpanded && (
                        <div className='p-4 border-t bg-gray-50'>
                          <div className='mb-3 text-sm overflow-y-scroll'>
                            {group.errors.map((error, errorIndex) => (
                              <ErrorDetails
                                key={errorIndex}
                                error={error}
                                copied={copiedError?.groupIndex === index && copiedError.errorIndex === errorIndex}
                                onCopy={(text) => handleCopy(index, errorIndex, text)}
                                showCorrections={canSuggestCredentialFixes}
                                showTip={canSuggestCredentialFixes}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {hasWarnings && (
        <>
          <div className='flex items-center gap-2 mb-4'>
            <AlertCircle className='h-5 w-5 text-blue-500' />
            <h3 className='text-lg font-semibold'>
              {warnings.length} {warnings.length === 1 ? 'Warning' : 'Warnings'}
            </h3>
          </div>

          <div className='space-y-2'>
            {warnings.map((warning, index) => (
              <div key={index} className='rounded-lg border bg-white'>
                <div className='p-4 flex items-start justify-between'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-2'>
                      <span className='text-sm font-medium'>{`Additional property: "${warning.path}"`}</span>
                      <span className='ml-2 text-xs px-2 py-1 rounded bg-blue-100 text-blue-700'>
                        {getReadableKeyword(warning.errors[0].keyword)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
