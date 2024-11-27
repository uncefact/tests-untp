"use client";

import { CredentialUploader } from "@/components/CredentialUploader";
import { DownloadCredential } from "@/components/DownloadCredential";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { TestResults } from "@/components/TestResults";
import {
  decodeEnvelopedCredential,
  isEnvelopedProof,
} from "@/lib/credentialService";
import type { Credential, CredentialType } from "@/types/credential";
import { useState } from "react";
import { toast } from "sonner";

interface StoredCredential {
  original: any;
  decoded: Credential;
}

const CREDENTIAL_TYPES = [
  "DigitalProductPassport",
  "DigitalConformityCredential",
  "DigitalFacilityRecord",
  "DigitalIdentityAnchor",
  "DigitalTraceabilityEvent",
] as const;

export default function Home() {
  const [credentials, setCredentials] = useState<{
    [key in CredentialType]?: StoredCredential;
  }>({});

  const handleCredentialUpload = async (rawCredential: any) => {
    try {
      const normalizedCredential =
        rawCredential.verifiableCredential || rawCredential;

      if (!normalizedCredential || typeof normalizedCredential !== "object") {
        toast.error("Invalid credential format");
        return;
      }

      const isEnveloped = isEnvelopedProof(normalizedCredential);
      const decodedCredential = isEnveloped
        ? decodeEnvelopedCredential(normalizedCredential)
        : normalizedCredential;

      const credentialType = decodedCredential.type.find((t: string) =>
        CREDENTIAL_TYPES.includes(t as CredentialType)
      ) as CredentialType;

      if (!credentialType) {
        toast.error("Unknown credential type");
        return;
      }

      setCredentials((prev) => ({
        ...prev,
        [credentialType]: {
          original: normalizedCredential,
          decoded: decodedCredential,
        },
      }));
    } catch {
      toast.error("Failed to process credential");
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto p-8 max-w-7xl flex-1">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="md:w-2/3">
            <h2 className="text-xl font-semibold mb-6">Your Credentials</h2>
            <TestResults credentials={credentials} />
          </div>
          <div className="md:w-1/3 flex flex-col space-y-8">
            <div>
              <h2 className="text-xl font-semibold mb-6">Add New Credential</h2>
              <div className="h-[300px]">
                <CredentialUploader
                  onCredentialUpload={handleCredentialUpload}
                />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-6">
                Download Test Credential
              </h2>
              <DownloadCredential />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
