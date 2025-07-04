import { ValidationError } from '@/types';
import { AlertCircle, Check, ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';

interface ErrorDialogProps {
  errors: any[];
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
    minItems: 'to few items',
    conflictingProperties: 'conflicting field',
  };
  return keywords[keyword] || keyword;
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
    case 'type':
      return `Change the value to match the expected type: ${mainError?.params?.type ?? 'type'}.`;
    case 'conflictingProperties':
      return 'Resolve the conflict by removing the conflicting field or updating it to a unique one.';
    default:
      return 'Make sure your input matches the required format.';
  }
};

export const ErrorDialog: React.FC<ErrorDialogProps> = ({ errors = [], className = '' }) => {
  const [expandedError, setExpandedError] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }

  const { issues, warnings } = groupErrors(errors);
  const hasIssues = issues.length > 0;
  const hasWarnings = warnings.length > 0;

  return (
    <div className={className}>
      {hasIssues && (
        <>
          <div className='flex items-center gap-2 mb-4'>
            <AlertCircle className='h-5 w-5 text-amber-500' />
            <h3 className='text-lg font-semibold'>
              We Found {issues.length} {issues.length === 1 ? 'Issue' : 'Issues'}
            </h3>
          </div>

          <div className='space-y-4 mb-6'>
            {issues.map((group, index) => {
              const mainError = group.errors[0];
              const isExpanded = expandedError === index;
              const isAdditionalProp = mainError.keyword === 'additionalProperties';
              const value = mainError.params?.allowedValue || mainError.params?.allowedValues;
              const fixExample = value ? JSON.stringify(value, null, 2) : null;

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
                              {mainError.keyword === 'const'
                                ? 'Use the correct value'
                                : mainError.keyword === 'enum'
                                  ? 'Choose from allowed values'
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
                          <p className='text-sm text-gray-600 mt-1'>
                            Location: {getFriendlyPath(mainError.instancePath)}
                          </p>
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
                            {mainError?.message && <p>Issue: {mainError.message}</p>}
                            <br />
                            {mainError.params?.receivedValue && (
                              <>
                                <p>Receive value:</p>
                                <br />
                                <pre className='bg-white p-3 rounded border text-sm overflow-x-auto'>
                                  <code className='text-green-600 block py-4'>
                                    {JSON.stringify(mainError.params?.receivedValue, null, 2)}
                                  </code>
                                </pre>
                              </>
                            )}
                            <br />
                            {mainError.keyword === 'const' && (
                              <div className='flex flex-col gap-2'>
                                <p>
                                  Incorrect value:{' '}
                                  <code className='px-1 py-0.5 bg-gray-100 rounded'>{mainError.instancePath}</code>
                                </p>
                              </div>
                            )}
                            {mainError.keyword === 'required' && (
                              <p>
                                Missing field:{' '}
                                <code className='px-1 py-0.5 bg-gray-100 rounded'>
                                  {mainError.params.missingProperty}
                                </code>
                              </p>
                            )}
                            {mainError.keyword === 'enum' && (
                              <p>
                                Must be one of:{' '}
                                <code className='px-1 py-0.5 bg-gray-100 rounded'>
                                  {mainError.params.allowedValues.join(', ')}
                                </code>
                              </p>
                            )}
                            {mainError.keyword === 'type' && (
                              <p>
                                <b>Expected type: </b>
                                <code className='px-1 py-0.5 bg-gray-100 rounded'>{mainError.params.type}</code>
                              </p>
                            )}
                            {mainError.keyword === 'missingValue' && <p>{mainError?.message}</p>}
                            {mainError.keyword === 'minItems' && (
                              <p>
                                Expected minimum number of items:{' '}
                                <code className='px-1 py-0.5 bg-gray-100 rounded'>{mainError.params.minItems}</code>
                              </p>
                            )}
                            {mainError.keyword === 'conflictingProperties' && (
                              <div className='flex flex-col gap-2'>
                                <p>
                                  Conflicting field:{' '}
                                  <code className='px-1 py-0.5 bg-gray-100 rounded'>
                                    {mainError.params.conflictingProperty}
                                  </code>
                                </p>
                              </div>
                            )}
                            {mainError.keyword === 'schema' && (
                              <div className='flex flex-col gap-2'>
                                <p>
                                  Error message:
                                  <code className='px-1 py-0.5 bg-gray-100 rounded'>
                                    {mainError.params.missingValue}
                                  </code>
                                </p>
                              </div>
                            )}
                          </div>

                          {fixExample && (
                            <div className='relative mt-2'>
                              <p className='text-sm'>Example: </p>
                              <pre className='bg-white p-3 rounded border text-sm overflow-x-auto'>
                                <code className='text-green-600 block py-4'>{fixExample}</code>
                              </pre>
                              <button
                                onClick={() => handleCopy(fixExample)}
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

                          <div className='mt-3 text-sm text-blue-800 bg-blue-50 p-3 rounded'>
                            <strong>Tip: </strong>
                            {getTipMessage(mainError)}
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
