import type { ValidationError } from '@/types';
import { describeArtefactFailure, type ArtefactFailureFamily, type ArtefactStepFailure } from '@/lib/artefactFailure';
import {
  buildValidationCards,
  errorTip,
  isJsonLdKeyword,
  isMessageValidationError,
  isValidatorError,
} from '@/lib/validationErrorCards';
import { AlertCircle, Check, ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';

interface ErrorDialogProps {
  errors: any[];
  failure?: ArtefactStepFailure;
  family?: ArtefactFailureFamily;
  className?: string;
}

const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL || 'https://github.com/uncefact/tests-untp/issues';

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

interface ErrorDetailsProps {
  error: ValidationError;
  copied: boolean;
  onCopy: (text: string) => void;
  showCorrections: boolean;
  fallbackTip?: string;
}

const ErrorDetails: React.FC<ErrorDetailsProps> = ({ error, copied, onCopy, showCorrections, fallbackTip }) => {
  const value = error.params?.allowedValue || error.params?.allowedValues;
  const fixExample = value ? safeStringify(value, true) : null;
  const tip = errorTip(error, fallbackTip);

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

      {tip && !(error.instancePath === '' && (error.keyword === 'false schema' || error.keyword === 'not')) && (
        <div className='mt-3 text-sm text-blue-800 bg-blue-50 p-3 rounded'>
          <strong>Tip: </strong>
          {tip}
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
  if (!Array.isArray(errors)) return null;

  const canSuggestCredentialFixes = !presentation || failure?.class === 'credential-invalid';

  if (errors.length === 0 && !presentation) {
    return null;
  }

  const { issues, warnings: warningGroups } = buildValidationCards(errors, failure);
  const issueCount = issues.reduce((count, group) => count + group.errors.length, 0);
  const hasIssues = issues.length > 0;
  const hasWarnings = warningGroups.length > 0;

  return (
    <div className={className}>
      {failure?.code === 'schema.validation.meta-schema' && (issues.length > 0 || warningGroups.length > 0) && (
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
            {issues.map((card, index) => {
              const mainError = card.errors[0];
              const isExpanded = expandedError === index;
              const isMessageError = isMessageValidationError(mainError);
              const isAdditionalProp = isValidatorError(mainError) && mainError.keyword === 'additionalProperties';

              return (
                <div
                  key={index}
                  className='rounded-lg border bg-white'
                  data-testid='validation-issue-card'
                  data-relation-rule={isMessageError && mainError.relationRule ? 'true' : undefined}
                >
                  {isMessageError ? (
                    <div className='p-4'>
                      {presentation && card.isFailure && (
                        <h4 className='text-sm font-medium' data-testid='failure-card-heading'>
                          {presentation.heading}
                        </h4>
                      )}
                      {card.path && <p className='text-sm text-gray-600'>Location: {card.path}</p>}
                      <p className='mt-2 text-sm text-gray-600'>{card.message}</p>
                      {card.detail && <p className='mt-2 text-sm text-muted-foreground'>{card.detail}</p>}
                      {card.tip && (
                        <div className='mt-3 rounded bg-blue-50 p-3 text-sm text-blue-800'>
                          <strong>Tip: </strong>
                          {card.tip}
                        </div>
                      )}
                      {card.supportable && (
                        <p className='mt-2 text-sm text-gray-600'>
                          If this keeps happening,{' '}
                          <a href={SUPPORT_URL} target='_blank' rel='noopener noreferrer' className='underline'>
                            report an issue
                          </a>
                          .
                        </p>
                      )}
                    </div>
                  ) : isAdditionalProp ? (
                    <div className='p-4 flex items-start justify-between'>
                      <div className='flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>{card.message}</span>
                          {card.keyword && (
                            <span className='ml-2 text-xs px-2 py-1 rounded bg-blue-100 text-blue-700'>
                              {card.keyword}
                            </span>
                          )}
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
                              {canSuggestCredentialFixes && isValidatorError(mainError) && mainError.keyword === 'const'
                                ? 'Use the correct value'
                                : canSuggestCredentialFixes &&
                                    isValidatorError(mainError) &&
                                    mainError.keyword === 'enum'
                                  ? 'Choose from allowed values'
                                  : presentation && failure?.class !== 'credential-invalid'
                                    ? 'Diagnostic details'
                                    : isValidatorError(mainError) && isJsonLdKeyword(mainError.keyword)
                                      ? errorHeaderText(mainError)
                                      : family === 'link-set'
                                        ? 'Review link set validation error'
                                        : 'Fix validation error'}
                            </span>
                            <span
                              className={`ml-2 text-xs px-2 py-1 rounded ${
                                isValidatorError(mainError) && mainError.keyword === 'const'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {card.keyword}
                            </span>
                          </div>
                          {card.path && <p className='text-sm text-gray-600 mt-1'>Location: {card.path}</p>}
                          <div className='mt-2 space-y-1'>
                            {card.messages.map((message, errorIndex) => (
                              <p key={errorIndex} className='text-sm text-gray-600'>
                                {message}
                              </p>
                            ))}
                          </div>
                          {!isExpanded && card.tip && (
                            <div className='mt-3 rounded bg-blue-50 p-3 text-sm text-blue-800'>
                              <strong>Tip: </strong>
                              {card.tip}
                            </div>
                          )}
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
                            {card.errors.filter(isValidatorError).map((error, errorIndex) => (
                              <ErrorDetails
                                key={errorIndex}
                                error={error}
                                copied={copiedError?.groupIndex === index && copiedError.errorIndex === errorIndex}
                                onCopy={(text) => handleCopy(index, errorIndex, text)}
                                showCorrections={canSuggestCredentialFixes}
                                fallbackTip={failure?.remediation}
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
              {warningGroups.length} {warningGroups.length === 1 ? 'Warning' : 'Warnings'}
            </h3>
          </div>

          <div className='space-y-2'>
            {warningGroups.map((warning, index) => {
              const mainWarning = warning.errors[0];
              const isMessageWarning = isMessageValidationError(mainWarning);
              return (
                <div
                  key={index}
                  className='rounded-lg border bg-white'
                  data-testid='validation-warning-card'
                  data-relation-rule={isMessageWarning && mainWarning.relationRule ? 'true' : undefined}
                >
                  {isMessageWarning ? (
                    <div className='p-4'>
                      {warning.path && <p className='text-sm text-gray-600'>Location: {warning.path}</p>}
                      <p className='mt-2 text-sm text-gray-600'>{warning.message}</p>
                    </div>
                  ) : (
                    <div className='p-4 flex items-start justify-between'>
                      <div className='flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>{warning.message}</span>
                          {warning.keyword && (
                            <span className='ml-2 text-xs px-2 py-1 rounded bg-blue-100 text-blue-700'>
                              {warning.keyword}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
