'use client';

import { SourceCaption } from '@/components/SourceCaption';
import { StatusIcon } from '@/components/StatusIcon';
import { Card } from '@/components/ui/card';
import { validateContext } from '@/lib/contextValidation';
import { detectSchemeVersion, SchemaFetchError, validateSchemeSchema } from '@/lib/schemeValidation';
import type { StoredScheme, TestStep } from '@/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { SchemeType, TestCaseStatus, TestCaseStepId } from '../../constants';
import { confettiConfig } from '@/components/TestResults';

interface SchemeTestResultsProps {
  schemes: { [key in SchemeType]?: StoredScheme };
  testResults: { [key in SchemeType]?: TestStep[] };
  setTestResults: React.Dispatch<React.SetStateAction<{ [key in SchemeType]?: TestStep[] }>>;
}

const SCHEME_DISPLAY_LABEL: Record<SchemeType, string> = {
  [SchemeType.CONFORMITY_SCHEME]: 'ConformityScheme',
};

const initialSteps: TestStep[] = [
  { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection', status: TestCaseStatus.PENDING },
  { id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION, name: 'Schema Validation', status: TestCaseStatus.PENDING },
  {
    id: TestCaseStepId.CONTEXT_VALIDATION,
    name: 'JSON-LD Document Expansion and Context Validation',
    status: TestCaseStatus.PENDING,
  },
];

export function SchemeTestResults({ schemes, testResults, setTestResults }: SchemeTestResultsProps) {
  const validatedRef = useRef<{ [key in SchemeType]?: unknown }>({});
  const confettiShownRef = useRef<{ [key in SchemeType]?: unknown }>({});

  useEffect(() => {
    (Object.values(SchemeType) as SchemeType[]).forEach((type) => {
      const stored = schemes[type];
      if (!stored) return;

      const alreadyValidated = validatedRef.current[type] === stored.original;
      if (alreadyValidated) return;

      validatedRef.current[type] = stored.original;
      confettiShownRef.current[type] = undefined;
      setTestResults((prev) => ({ ...prev, [type]: initialSteps.map((step) => ({ ...step })) }));

      void runPipeline(type, stored, setTestResults);
    });
  }, [schemes, setTestResults]);

  useEffect(() => {
    (Object.values(SchemeType) as SchemeType[]).forEach((type) => {
      const stored = schemes[type];
      const steps = testResults[type];
      if (!stored || !steps || steps.length === 0) return;
      const allPassed = steps.every((step) => step.status === TestCaseStatus.SUCCESS);
      if (!allPassed) return;
      if (confettiShownRef.current[type] === stored.original) return;
      confettiShownRef.current[type] = stored.original;
      confetti(confettiConfig);
    });
  }, [schemes, testResults]);

  return (
    <section className='space-y-4' data-testid='scheme-results'>
      {(Object.values(SchemeType) as SchemeType[]).map((type) => (
        <SchemeCard key={type} type={type} scheme={schemes[type]} steps={testResults[type] ?? []} />
      ))}
    </section>
  );
}

async function runPipeline(
  type: SchemeType,
  stored: StoredScheme,
  setTestResults: React.Dispatch<React.SetStateAction<{ [key in SchemeType]?: TestStep[] }>>,
) {
  const setStep = (stepId: TestCaseStepId, patch: Partial<TestStep>) => {
    setTestResults((prev) => ({
      ...prev,
      [type]: prev[type]?.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    }));
  };

  setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, { status: TestCaseStatus.IN_PROGRESS });
  const version = detectSchemeVersion(stored.decoded);
  if (!version) {
    const message =
      'Could not detect a UNTP version from the @context. Add a UNTP context URI (e.g. https://vocabulary.uncefact.org/untp/0.7.0/context/).';
    setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [{ message }] },
    });
    setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [{ message: 'Skipped: version detection failed.' }] },
    });
    setStep(TestCaseStepId.CONTEXT_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [{ message: 'Skipped: version detection failed.' }] },
    });
    return;
  }
  setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, { status: TestCaseStatus.SUCCESS });

  setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, { status: TestCaseStatus.IN_PROGRESS });
  try {
    const result = await validateSchemeSchema(stored.decoded, version);
    setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
      status: result.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
      details: result.valid ? undefined : { errors: result.errors },
    });
  } catch (err) {
    setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [schemaFetchError(err)] },
    });
  }

  setStep(TestCaseStepId.CONTEXT_VALIDATION, { status: TestCaseStatus.IN_PROGRESS });
  try {
    const contextResult = await validateContext(stored.decoded);
    setStep(TestCaseStepId.CONTEXT_VALIDATION, {
      status: contextResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
      details: contextResult.valid ? undefined : { errors: contextResult.error ? [contextResult.error] : [] },
    });
  } catch (err) {
    setStep(TestCaseStepId.CONTEXT_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: {
        errors: [
          {
            message: err instanceof Error ? err.message : 'Failed to validate JSON-LD context.',
            supportable: true,
          },
        ],
      },
    });
  }
}

const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL || 'https://github.com/uncefact/tests-untp/issues';

interface DisplayableError {
  message: string;
  supportable?: boolean;
}

function stepErrors(step: TestStep): DisplayableError[] {
  const errors = step.details?.errors;
  if (!Array.isArray(errors)) return [];
  const out: DisplayableError[] = [];
  for (const e of errors) {
    if (typeof e?.message !== 'string' || e.message.length === 0) continue;
    out.push({ message: e.message, supportable: e.supportable === true });
  }
  return out;
}

function schemaFetchError(err: unknown): DisplayableError {
  if (err instanceof SchemaFetchError) {
    switch (err.reason) {
      case 'timeout':
        return {
          message: 'The schema service did not respond in time. Please try again.',
          supportable: true,
        };
      case 'not-found':
        return {
          message: `No schema is published at ${err.schemaUrl}. Check that the scheme's @context references a UNTP version with a published schema.`,
        };
      case 'parse':
        return {
          message: 'The schema service returned a response that was not valid JSON. Please try again.',
          supportable: true,
        };
      case 'network':
      default:
        return {
          message: 'We could not reach the schema service. Please try again.',
          supportable: true,
        };
    }
  }
  return {
    message: err instanceof Error ? err.message : 'Schema validation failed for an unknown reason.',
    supportable: true,
  };
}

function schemeName(scheme: StoredScheme | undefined): string | undefined {
  const name = scheme?.decoded?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function schemeVersion(scheme: StoredScheme | undefined): string | undefined {
  if (!scheme) return undefined;
  return detectSchemeVersion(scheme.decoded) ?? undefined;
}

function SchemeCard({
  type,
  scheme,
  steps,
}: {
  type: SchemeType;
  scheme: StoredScheme | undefined;
  steps: TestStep[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasScheme = scheme !== undefined;

  const overallStatus = useMemo(() => {
    if (!hasScheme) return TestCaseStatus.PENDING;
    if (steps.length === 0) return TestCaseStatus.PENDING;
    if (steps.some((step) => step.status === TestCaseStatus.IN_PROGRESS || step.status === TestCaseStatus.PENDING)) {
      return TestCaseStatus.IN_PROGRESS;
    }
    return steps.every((step) => step.status === TestCaseStatus.SUCCESS)
      ? TestCaseStatus.SUCCESS
      : TestCaseStatus.FAILURE;
  }, [hasScheme, steps]);

  return (
    <Card className='p-4'>
      <div
        className='flex flex-wrap items-center justify-between gap-2 cursor-pointer'
        onClick={() => setIsExpanded((prev) => !prev)}
        data-testid={`${type}-group-header`}
      >
        <div className='flex items-center gap-2'>
          {isExpanded ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
          <div className='flex flex-col'>
            <h3 className='font-semibold'>{schemeName(scheme) ?? SCHEME_DISPLAY_LABEL[type]}</h3>
            {schemeName(scheme) && (
              <span className='text-xs text-gray-500'>
                {SCHEME_DISPLAY_LABEL[type]}
                {schemeVersion(scheme) && ` (v${schemeVersion(scheme)})`}
              </span>
            )}
            {!schemeName(scheme) && schemeVersion(scheme) && (
              <span className='text-xs text-gray-500'>v{schemeVersion(scheme)}</span>
            )}
          </div>
        </div>
        <StatusIcon status={overallStatus} testId={type} />
      </div>
      {isExpanded && (
        <div className='mt-4 pl-6 space-y-2'>
          {scheme?.source && <SourceCaption source={scheme.source} />}
          {steps.length > 0 ? (
            steps.map((step) => (
              <div key={step.id} className='py-2'>
                <div className='flex items-center gap-2'>
                  <StatusIcon status={step.status} testId={step.id} />
                  <span>{step.name}</span>
                </div>
                {step.status === TestCaseStatus.FAILURE && stepErrors(step).length > 0 && (
                  <ul className='mt-1 pl-6 list-disc text-sm text-red-600 space-y-1'>
                    {stepErrors(step).map((error, idx) => (
                      <li key={idx}>
                        {error.message}
                        {error.supportable && (
                          <>
                            {' '}
                            If this keeps happening,{' '}
                            <a href={SUPPORT_URL} target='_blank' rel='noopener noreferrer' className='underline'>
                              report an issue
                            </a>
                            .
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          ) : (
            <p className='text-sm text-gray-500 italic'>Upload a conformity scheme to begin validation.</p>
          )}
        </div>
      )}
    </Card>
  );
}
