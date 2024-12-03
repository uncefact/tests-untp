"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { isEnvelopedProof } from "@/lib/credentialService";
import { validateCredentialSchema } from "@/lib/schemaValidation";
import { verifyCredential } from "@/lib/verificationService";
import type { Credential, CredentialType, TestStep } from "@/types/credential";
import confetti from "canvas-confetti";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorDialog } from "./ErrorDialog";

// Define all possible credential types
const ALL_CREDENTIAL_TYPES: CredentialType[] = [
  "DigitalProductPassport",
  "DigitalConformityCredential",
  "DigitalFacilityRecord",
  "DigitalIdentityAnchor",
  "DigitalTraceabilityEvent",
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
  isExpanded: boolean;
  onToggle: () => void;
}

const TestGroup = ({
  credentialType,
  version,
  steps,
  isExpanded,
  onToggle,
  proofType,
  hasCredential,
}: TestGroupProps & {
  proofType: "enveloping" | "embedded" | "none";
  hasCredential: boolean;
}) => {
  const isLoading = steps.some((step) => step.status === "in-progress");

  const overallStatus = useMemo(() => {
    if (!hasCredential) return "missing";
    if (version === "unknown") return "failure";
    if (isLoading || steps.some((step) => step.status === "pending"))
      return "in-progress";
    return steps.every((step) => step.status === "success")
      ? "success"
      : "failure";
  }, [steps, isLoading, hasCredential, version]);

  return (
    <Card className="p-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <h3 className="font-semibold">
            {credentialType}
            {hasCredential &&
              ` (${
                version === "unknown" ? version + " version" : "v" + version
              })`}
          </h3>
        </div>
        <div className="flex items-center gap-4">
          {hasCredential && proofType !== "none" && (
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                proofType === "enveloping"
                  ? "bg-green-100 text-green-800"
                  : "bg-yellow-100 text-yellow-800"
              }`}
            >
              {proofType} proof
            </span>
          )}
          <StatusIcon status={overallStatus} />
        </div>
      </div>
      {isExpanded && (
        <div className="mt-4 pl-6 space-y-2">
          {steps.map((step) => (
            <TestStepItem key={step.id} step={step} />
          ))}
          {!hasCredential && (
            <p className="text-sm text-gray-500 italic">
              Upload a credential to begin validation
            </p>
          )}
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
      (step.details.additionalProperties &&
        Object.keys(step.details.additionalProperties).length > 0));

  return (
    <div className="py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon status={step.status} />
          <span>{step.name}</span>
        </div>
        {step.details &&
          step.id === "schema" &&
          (step.details.errors?.[0]?.message === "Failed to fetch schema" ? (
            <span className="text-sm text-red-500">Failed to load schema</span>
          ) : shouldShowDetails ? (
            <Sheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm">
                  View Details
                </Button>
              </SheetTrigger>
              <SheetContent className="sm:max-w-[600px]">
                <SheetHeader>
                  <SheetTitle>Validation Details</SheetTitle>
                </SheetHeader>
                <div className="mt-4 overflow-y-auto max-h-[calc(100vh-8rem)]">
                  {step.details.errors && step.details.errors.length > 0 ? (
                    <ErrorDialog
                      errors={step.details.errors}
                      className="w-full max-w-none"
                    />
                  ) : (
                    <div className="text-yellow-600">
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
  size = "default",
}: {
  status: TestStep["status"];
  size?: "sm" | "default";
}) => {
  const sizeClass = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  switch (status) {
    case "success":
      return <Check className={`${sizeClass} text-green-500`} />;
    case "failure":
      return <X className={`${sizeClass} text-red-500`} />;
    case "in-progress":
      return <Loader2 className={`${sizeClass} text-blue-500 animate-spin`} />;
    case "missing":
      return <AlertCircle className={`${sizeClass} text-gray-400`} />;
    default:
      return <AlertCircle className={`${sizeClass} text-gray-400`} />;
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
  const previousCredentialsRef = useRef(credentials);

  const initializeTestSteps = (credential?: {
    original: any;
    decoded: Credential;
  }) => {
    if (!credential) {
      return [
        {
          id: "proof-type",
          name: "Proof Type Detection",
          status: "missing",
        },
        {
          id: "verification",
          name: "Credential Verification",
          status: "missing",
        },
        {
          id: "schema",
          name: "Schema Validation",
          status: "missing",
        },
      ];
    }

    return [
      {
        id: "proof-type",
        name: "Proof Type Detection",
        status: "success",
        details: {
          type: isEnvelopedProof(credential.original)
            ? "enveloping"
            : "embedded",
        },
      },
      {
        id: "verification",
        name: "Credential Verification",
        status: "pending",
      },
      {
        id: "schema",
        name: "Schema Validation",
        status: "pending",
      },
    ];
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
            [type as CredentialType]: prev[type as CredentialType]?.map(
              (step) =>
                step.id === "verification" || step.id === "schema"
                  ? { ...step, status: "in-progress" }
                  : step
            ),
          }));

          // Verification
          const verificationResult = await verifyCredential(
            credential.original
          );
          setTestResults((prev) => ({
            ...prev,
            [type as CredentialType]: prev[type as CredentialType]?.map(
              (step) =>
                step.id === "verification"
                  ? {
                      ...step,
                      status: verificationResult.verified
                        ? "success"
                        : "failure",
                      details: verificationResult,
                    }
                  : step
            ),
          }));

          if (!verificationResult.verified) {
            const errorMessage =
              typeof verificationResult.error === "object"
                ? verificationResult.error.message ||
                  "The credential could not be verified"
                : verificationResult.error ||
                  "The credential could not be verified";

            toast.error("Credential verification failed", {
              description: errorMessage,
            });
          }

          // Schema validation
          try {
            const validationResult = await validateCredentialSchema(
              credential.decoded
            );
            setTestResults((prev) => ({
              ...prev,
              [type as CredentialType]: prev[type as CredentialType]?.map(
                (step) =>
                  step.id === "schema"
                    ? {
                        ...step,
                        status: validationResult.valid ? "success" : "failure",
                        details: validationResult,
                      }
                    : step
              ),
            }));

            // Store reference to validated credential
            validatedCredentialsRef.current[credentialType] = {
              credential: {
                original: credential.original,
                decoded: credential.decoded,
              },
              validated: true,
            };

            if (validationResult.valid) {
              if (
                !validatedCredentialsRef.current[credentialType]?.confettiShown
              ) {
                confetti({
                  particleCount: 200,
                  spread: 90,
                  origin: { y: 0.7 },
                });

                validatedCredentialsRef.current[credentialType] = {
                  ...validatedCredentialsRef.current[credentialType]!,
                  confettiShown: true,
                };
              }
            }
          } catch (error) {
            console.log("Schema validation error:", error);
            toast.error("Failed to fetch schema. Please try again.");

            // Only update the schema validation step
            setTestResults((prev) => ({
              ...prev,
              [type as CredentialType]: prev[type as CredentialType]?.map(
                (step) =>
                  step.id === "schema"
                    ? {
                        ...step,
                        status: "failure",
                        details: {
                          errors: [
                            {
                              keyword: "schema",
                              message: "Failed to fetch schema",
                              instancePath: "",
                            },
                          ],
                        },
                      }
                    : step
              ),
            }));
          }
        } catch (error) {
          console.log("Error processing credential:", error);
        }
      };

      verifyAndValidate();
    });
  }, [credentials]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    );
  };

  return (
    <div className="space-y-4 h-full overflow-y-auto">
      {ALL_CREDENTIAL_TYPES.map((type) => {
        const credential = credentials[type];
        const steps = testResults[type] || [];
        const hasCredential = !!credential;
        const proofType = credential
          ? isEnvelopedProof(credential.original)
            ? "enveloping"
            : "embedded"
          : "none";

        return (
          <TestGroup
            key={type}
            credentialType={type}
            version={
              credential ? extractVersion(credential.decoded) : "unknown"
            }
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

// Helper function to extract version
function extractVersion(credential: Credential): string {
  try {
    if (!credential["@context"] || !Array.isArray(credential["@context"])) {
      return "unknown";
    }

    const contextUrl = credential["@context"].find(
      (ctx) =>
        typeof ctx === "string" &&
        (ctx.includes("vocabulary.uncefact.org") ||
          ctx.includes("test.uncefact.org"))
    );

    return contextUrl?.match(/\/(\d+\.\d+\.\d+)\//)?.[1] || "unknown";
  } catch {
    return "unknown";
  }
}
