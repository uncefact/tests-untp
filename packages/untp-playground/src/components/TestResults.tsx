'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { detectVersion, isEnvelopedProof } from '@/lib/credentialService';
import { detectExtension, validateCredentialSchema, validateExtension } from '@/lib/schemaValidation';
import { detectVcdmVersion } from '@/lib/utils';
import { validateVcdmRules } from '@/lib/vcdm-validation';
import { verifyCredential } from '@/lib/verificationService';
import type { Credential, CredentialType, TestStep } from '@/types/credential';
import confetti from 'canvas-confetti';
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { TestCaseStatus, TestCaseStepId, VCDMVersion, VCProofType } from '../../constants';
import { ErrorDialog } from './ErrorDialog';

// Define all possible credential types
const ALL_CREDENTIAL_TYPES: CredentialType[] = [
  'DigitalProductPassport',
  'DigitalConformityCredential',
  'DigitalFacilityRecord',
  'DigitalIdentityAnchor',
  'DigitalTraceabilityEvent',
];

// Add this type to help with tracking previous credentials
type CredentialCache = {
  [key in CredentialType]?: {
    credential: {
      original: any;
      decoded: Credential;
    };
    validated: boolean;
    confettiShown?: boolean;
  };
};

interface TestGroupProps {
  credentialType: string;
  version: string;
  steps: TestStep[];
  proofType: VCProofType;
  vcdmVersion: VCDMVersion | undefined;
  hasCredential: boolean;
  extensionCredentialType?: string;
  extensionVersion?: string;
  isExpanded: boolean;
  onToggle: () => void;
}

export const confettiConfig = {
  particleCount: 200,
  spread: 90,
  origin: { y: 0.7 },
};

const TestGroup = ({
  credentialType,
  version,
  extensionCredentialType,
  extensionVersion,
  steps,
  isExpanded,
  onToggle,
  proofType,
  hasCredential,
  vcdmVersion,
}: TestGroupProps) => {
  const isLoading = steps.some((step) => step.status === 'in-progress');

  const overallStatus = useMemo(() => {
    if (!hasCredential) return TestCaseStatus.PENDING;
    if (version === VCDMVersion.UNKNOWN) return TestCaseStatus.FAILURE;
    if (isLoading || steps.some((step) => step.status === TestCaseStatus.PENDING)) return TestCaseStatus.IN_PROGRESS;
    return steps.every((step) => step.status === TestCaseStatus.SUCCESS)
      ? TestCaseStatus.SUCCESS
      : TestCaseStatus.FAILURE;
  }, [steps, isLoading, hasCredential, version]);

  return (
    <Card className='p-4'>
      <div
        className='flex flex-wrap items-center justify-between gap-2 cursor-pointer'
        onClick={onToggle}
        data-testid={`${credentialType}-group-header`}
      >
        <div className='flex items-center gap-2'>
          {isExpanded ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
          <h3 className='font-semibold'>
            {credentialType}
            {hasCredential && ` (${version === VCDMVersion.UNKNOWN ? version + ' version' : 'v' + version})`}
          </h3>
          {extensionCredentialType && (
            <h4 className='text-sm text-gray-500'>
              {extensionCredentialType}
              {extensionVersion === VCDMVersion.UNKNOWN ? 'unknown' : ` (v${extensionVersion})`}
            </h4>
          )}
        </div>
        <div className='flex items-center gap-4'>
          {hasCredential && proofType !== VCProofType.UNKNOWN && (
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                proofType === VCProofType.ENVELOPING ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {proofType} proof
            </span>
          )}
          {hasCredential && vcdmVersion && (
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                vcdmVersion === VCDMVersion.UNKNOWN ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
              }`}
            >
              {vcdmVersion === VCDMVersion.UNKNOWN ? 'Unsupported VCDM version' : `VCDM ${vcdmVersion}`}
            </span>
          )}
          <StatusIcon status={overallStatus} testId={`${credentialType}`} />
        </div>
      </div>
      {isExpanded && (
        <div className='mt-4 pl-6 space-y-2'>
          {steps.map((step) => (
            <TestStepItem key={step.id} step={step} />
          ))}
          {!hasCredential && <p className='text-sm text-gray-500 italic'>Upload a credential to begin validation</p>}
        </div>
      )}
    </Card>
  );
};

const TestStepItem = ({ step }: { step: TestStep }) => {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const shouldShowDetails =
    step.details &&
    ((step.details.errors && step.details.errors.length > 0) ||
      (step.details.additionalProperties && Object.keys(step.details.additionalProperties).length > 0));

  return (
    <div className='py-2'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <StatusIcon status={step.status} testId={`${step.id}`} />
          <span>{step.name}</span>
        </div>
        {step.details &&
          (step.id === TestCaseStepId.UNTP_SCHEMA_VALIDATION ||
            step.id === TestCaseStepId.EXTENSION_SCHEMA_VALIDATION ||
            step.id === TestCaseStepId.VCDM_SCHEMA_VALIDATION) &&
          (step.details.errors?.[0]?.message === 'Failed to fetch schema' ? (
            <span className='text-sm text-red-500'>Failed to load schema</span>
          ) : shouldShowDetails ? (
            <Sheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
              <SheetTrigger asChild>
                <Button variant='ghost' size='sm'>
                  View Details
                </Button>
              </SheetTrigger>
              <SheetContent className='sm:max-w-[600px]'>
                <SheetHeader>
                  <SheetTitle>Validation Details</SheetTitle>
                </SheetHeader>
                <div className='mt-4 overflow-y-auto max-h-[calc(100vh-8rem)]'>
                  {step.details.errors && step.details.errors.length > 0 ? (
                    <ErrorDialog errors={step.details.errors} className='w-full max-w-none' />
                  ) : (
                    <div className='text-yellow-600'>
                      <p>⚠️ Additional properties found in credential</p>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          ) : null)}
      </div>
    </div>
  );
};

const StatusIcon = ({
  status,
  size = 'default',
  testId = 'unknown',
}: {
  status: TestCaseStatus;
  size?: 'sm' | 'default';
  testId?: string;
}) => {
  const sizeClass = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  switch (status) {
    case TestCaseStatus.SUCCESS:
      return (
        <div data-testid={`${testId}-status-icon-success`}>
          <Check className={`${sizeClass} text-green-500`} />
        </div>
      );
    case TestCaseStatus.FAILURE:
      return (
        <div data-testid={`${testId}-status-icon-failure`}>
          <X className={`${sizeClass} text-red-500`} />
        </div>
      );
    case TestCaseStatus.IN_PROGRESS:
      return (
        <div data-testid={`${testId}-status-icon-in-progress`}>
          <Loader2 className={`${sizeClass} text-blue-500 animate-spin`} />
        </div>
      );
    case TestCaseStatus.PENDING:
      return (
        <div data-testid={`${testId}-status-icon-pending`}>
          <AlertCircle className={`${sizeClass} text-gray-400`} />
        </div>
      );
    default:
      return (
        <div data-testid={`${testId}-status-icon-pending`}>
          <AlertCircle className={`${sizeClass} text-gray-400`} />
        </div>
      );
      ``;
  }
};

export function TestResults({
  credentials,
}: {
  credentials: {
    [key in CredentialType]?: { original: any; decoded: Credential };
  };
}) {
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [testResults, setTestResults] = useState<{
    [key in CredentialType]?: TestStep[];
  }>({});
  const validatedCredentialsRef = useRef<CredentialCache>({});
  const previousCredentialsRef = useRef<Partial<Record<CredentialType, { original: any; decoded: Credential }>>>({});

  const initializeTestSteps = (credential?: { original: any; decoded: Credential }) => {
    if (!credential) {
      return [
        {
          id: TestCaseStepId.PROOF_TYPE,
          name: 'Proof Type Detection',
          status: TestCaseStatus.PENDING,
        },
        {
          id: TestCaseStepId.VCDM_VERSION,
          name: 'VCDM Version Detection',
          status: TestCaseStatus.PENDING,
        },
        {
          id: TestCaseStepId.VCDM_SCHEMA_VALIDATION,
          name: 'VCDM Schema Validation',
          status: TestCaseStatus.PENDING,
        },
        {
          id: TestCaseStepId.VERIFICATION,
          name: 'Credential Verification',
          status: TestCaseStatus.PENDING,
        },
        {
          id: TestCaseStepId.UNTP_SCHEMA_VALIDATION,
          name: 'UNTP Schema Validation',
          status: TestCaseStatus.PENDING,
        },
      ];
    }

    const vcdmVersion = detectVcdmVersion(credential.decoded);
    const isUnsupportedVCDMVersion = vcdmVersion === VCDMVersion.UNKNOWN;

    const steps = [
      {
        id: TestCaseStepId.PROOF_TYPE,
        name: 'Proof Type Detection',
        status: 'success',
        details: {
          type: isEnvelopedProof(credential.original) ? VCProofType.ENVELOPING : VCProofType.EMBEDDED,
        },
      },
      {
        id: TestCaseStepId.VCDM_VERSION,
        name: 'VCDM Version Detection',
        status: isUnsupportedVCDMVersion ? TestCaseStatus.FAILURE : TestCaseStatus.SUCCESS,
        details: {
          version: vcdmVersion,
        },
      },
      {
        id: TestCaseStepId.VCDM_SCHEMA_VALIDATION,
        name: 'VCDM Schema Validation',
        status: TestCaseStatus.PENDING,
      },
      {
        id: TestCaseStepId.VERIFICATION,
        name: 'Credential Verification',
        status: TestCaseStatus.PENDING,
      },
      {
        id: TestCaseStepId.UNTP_SCHEMA_VALIDATION,
        name: 'UNTP Schema Validation',
        status: TestCaseStatus.PENDING,
      },
    ];

    const extension = detectExtension(credential.decoded);

    if (extension) {
      steps.push({
        id: TestCaseStepId.EXTENSION_SCHEMA_VALIDATION,
        name: 'Extension Schema Validation',
        status: TestCaseStatus.PENDING,
      });
    }
    return steps;
  };

  // First useEffect for initializing test steps
  useEffect(() => {
    ALL_CREDENTIAL_TYPES.forEach((type) => {
      const credential = credentials[type];
      const previousCredential = previousCredentialsRef.current[type];

      // Only initialize or update if the credential has changed
      if (credential !== previousCredential) {
        setTestResults((prev) => ({
          ...prev,
          [type]: initializeTestSteps(credential),
        }));
      }
    });

    previousCredentialsRef.current = credentials;
  }, [credentials]);

  // Validation useEffect
  useEffect(() => {
    Object.entries(credentials).forEach(([type, credential]) => {
      const credentialType = type as CredentialType;
      const cached = validatedCredentialsRef.current[credentialType];

      // Skip if this credential has already been validated
      if (cached?.credential.original === credential.original) {
        return;
      }

      const verifyAndValidate = async () => {
        try {
          // Set in-progress state
          setTestResults((prev) => ({
            ...prev,
            [type as CredentialType]: prev[type as CredentialType]?.map((step) =>
              step.id === TestCaseStepId.VERIFICATION ||
              step.id === TestCaseStepId.UNTP_SCHEMA_VALIDATION ||
              step.id === TestCaseStepId.VCDM_SCHEMA_VALIDATION
                ? { ...step, status: TestCaseStatus.IN_PROGRESS }
                : step,
            ),
          }));

          // Verification
          const verificationResult = await verifyCredential(credential.original);
          setTestResults((prev) => ({
            ...prev,
            [type as CredentialType]: prev[type as CredentialType]?.map((step) =>
              step.id === TestCaseStepId.VERIFICATION
                ? {
                    ...step,
                    status: verificationResult.verified ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
                    details: verificationResult,
                  }
                : step,
            ),
          }));

          if (!verificationResult.verified) {
            const errorMessage =
              typeof verificationResult.error === 'object'
                ? verificationResult.error.message || 'The credential could not be verified'
                : verificationResult.error || 'The credential could not be verified';

            toast.error('Credential verification failed', {
              description: errorMessage,
            });
          }

          // Store reference to validated credential
          validatedCredentialsRef.current[credentialType] = {
            credential: {
              original: credential.original,
              decoded: credential.decoded,
            },
            validated: true,
          };

          let allChecksPass = verificationResult.verified;
          const extension = detectExtension(credential.decoded);

          // VCDM schema validation
          try {
            const vcdmValidationResult = await validateVcdmRules(credential.decoded);

            allChecksPass = allChecksPass && vcdmValidationResult.valid;

            setTestResults((prev) => ({
              ...prev,
              [type as CredentialType]: prev[type as CredentialType]?.map((step) =>
                step.id === TestCaseStepId.VCDM_SCHEMA_VALIDATION
                  ? {
                      ...step,
                      status: vcdmValidationResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
                      details: vcdmValidationResult,
                    }
                  : step,
              ),
            }));
          } catch (error) {
            toast.error('Failed to fetch the VCDM schema. Please contact support.');

            allChecksPass = false;

            setTestResults((prev) => ({
              ...prev,
              [type as CredentialType]: prev[type as CredentialType]?.map((step) =>
                step.id === TestCaseStepId.VCDM_SCHEMA_VALIDATION
                  ? {
                      ...step,
                      status: TestCaseStatus.FAILURE,
                    }
                  : step,
              ),
            }));
          }

          // Schema validation
          try {
            const validationResult = await validateCredentialSchema(credential.decoded);
            allChecksPass = allChecksPass && validationResult.valid;

            setTestResults((prev) => ({
              ...prev,
              [type as CredentialType]: prev[type as CredentialType]?.map((step) =>
                step.id === TestCaseStepId.UNTP_SCHEMA_VALIDATION
                  ? {
                      ...step,
                      status: validationResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
                      details: validationResult,
                    }
                  : step,
              ),
            }));
          } catch (error) {
            allChecksPass = false;
            console.log('Schema validation error:', error);
            toast.error('Failed to fetch schema. Please try again.');

            // Only update the schema validation step
            setTestResults((prev) => ({
              ...prev,
              [type as CredentialType]: prev[type as CredentialType]?.map((step) =>
                step.id === TestCaseStepId.UNTP_SCHEMA_VALIDATION
                  ? {
                      ...step,
                      status: TestCaseStatus.FAILURE,
                      details: {
                        errors: [
                          {
                            keyword: 'schema',
                            message: 'Failed to fetch schema',
                            instancePath: '',
                          },
                        ],
                      },
                    }
                  : step,
              ),
            }));
          }

          // Extension schema validation
          if (extension) {
            try {
              const extensionValidationResult = await validateExtension(credential.decoded);
              allChecksPass = allChecksPass && extensionValidationResult.valid;

              setTestResults((prev) => ({
                ...prev,
                [type as CredentialType]: prev[type as CredentialType]?.map((step) =>
                  step.id === TestCaseStepId.EXTENSION_SCHEMA_VALIDATION
                    ? {
                        ...step,
                        status: extensionValidationResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
                        details: extensionValidationResult,
                      }
                    : step,
                ),
              }));
            } catch (error) {
              allChecksPass = false;
              console.log('Extension schema validation error:', error);
              toast.error('Failed to fetch extension schema. Please try again.');

              // Only update the schema validation step
              setTestResults((prev) => ({
                ...prev,
                [type as CredentialType]: prev[type as CredentialType]?.map((step) =>
                  step.id === TestCaseStepId.EXTENSION_SCHEMA_VALIDATION
                    ? {
                        ...step,
                        status: TestCaseStatus.FAILURE,
                        details: {
                          errors: [
                            {
                              keyword: 'schema',
                              message: 'Failed to fetch extension schema',
                              instancePath: '',
                            },
                          ],
                        },
                      }
                    : step,
                ),
              }));
            }
          }

          // Trigger confetti only if all checks pass
          if (allChecksPass && !validatedCredentialsRef.current[credentialType]?.confettiShown) {
            confetti(confettiConfig);

            validatedCredentialsRef.current[credentialType] = {
              ...validatedCredentialsRef.current[credentialType]!,
              confettiShown: true,
            };
          }
        } catch (error) {
          console.log('Error processing credential:', error);
        }
      };

      verifyAndValidate();
    });
  }, [credentials]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  };

  return (
    <div className='space-y-4 h-full overflow-y-auto'>
      {ALL_CREDENTIAL_TYPES.map((type) => {
        const credential = credentials[type];
        const steps = testResults[type] || [];
        const hasCredential = !!credential;
        const extension = hasCredential ? detectExtension(credential.decoded) : null;
        const version = hasCredential
          ? extension?.core?.version || detectVersion(credential.decoded)
          : VCDMVersion.UNKNOWN;
        const extensionCredentialType = extension?.extension?.type;
        const extensionVersion = extension?.extension?.version;
        const proofType = credential
          ? isEnvelopedProof(credential.original)
            ? VCProofType.ENVELOPING
            : VCProofType.EMBEDDED
          : VCProofType.UNKNOWN;
        const vcdmVersion = hasCredential ? detectVcdmVersion(credential.decoded) : undefined;

        return (
          <TestGroup
            key={type}
            credentialType={type}
            version={version}
            vcdmVersion={vcdmVersion}
            extensionCredentialType={extensionCredentialType}
            extensionVersion={extensionVersion}
            steps={steps}
            isExpanded={expandedGroups.includes(type)}
            onToggle={() => toggleGroup(type)}
            proofType={proofType}
            hasCredential={hasCredential}
          />
        );
      })}
    </div>
  );
}
