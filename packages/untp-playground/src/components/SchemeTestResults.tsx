'use client';

import { SectionHeader } from '@/components/SectionHeader';
import { StatusIcon } from '@/components/StatusIcon';
import { Card } from '@/components/ui/card';
import { validateContext } from '@/lib/contextValidation';
import { detectSchemeVersion, validateSchemeSchema } from '@/lib/schemeValidation';
import type { StoredScheme, TestStep } from '@/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SchemeType, TestCaseStatus, TestCaseStepId } from '../../constants';

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

  useEffect(() => {
    (Object.values(SchemeType) as SchemeType[]).forEach((type) => {
      const stored = schemes[type];
      if (!stored) return;

      const alreadyValidated = validatedRef.current[type] === stored.original;
      if (alreadyValidated) return;

      validatedRef.current[type] = stored.original;
      setTestResults((prev) => ({ ...prev, [type]: initialSteps.map((step) => ({ ...step })) }));

      void runPipeline(type, stored, setTestResults);
    });
  }, [schemes, setTestResults]);

  return (
    <section className='space-y-4' data-testid='scheme-results'>
      <SectionHeader title='Conformity Schemes' />
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
    setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, { status: TestCaseStatus.FAILURE });
    setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, { status: TestCaseStatus.FAILURE });
    setStep(TestCaseStepId.CONTEXT_VALIDATION, { status: TestCaseStatus.FAILURE });
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
      details: { errors: [{ message: err instanceof Error ? err.message : 'Failed to fetch scheme schema' }] },
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
      details: { errors: [{ message: err instanceof Error ? err.message : 'Failed to validate JSON-LD context' }] },
    });
  }
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
          <h3 className='font-semibold'>{SCHEME_DISPLAY_LABEL[type]}</h3>
        </div>
        <StatusIcon status={overallStatus} testId={type} />
      </div>
      {isExpanded && (
        <div className='mt-4 pl-6 space-y-2'>
          {steps.length > 0 ? (
            steps.map((step) => (
              <div key={step.id} className='py-2 flex items-center gap-2'>
                <StatusIcon status={step.status} testId={step.id} />
                <span>{step.name}</span>
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
