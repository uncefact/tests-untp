import type { Credential } from "@/types/credential";
import { jwtDecode } from "jwt-decode";

export function decodeEnvelopedCredential(credential: any): Credential {
  if (!isEnvelopedProof(credential)) {
    return credential;
  }

  try {
    const jwtPart = credential.id.split(",")[1];
    if (!jwtPart) {
      return credential;
    }

    return jwtDecode(jwtPart);
  } catch (error) {
    console.log("Error processing enveloped credential:", error);
    return credential;
  }
}

export function detectCredentialType(credential: Credential): string {
  const types = [
    "DigitalProductPassport",
    "DigitalConformityCredential",
    "DigitalFacilityRecord",
    "DigitalIdentityAnchor",
    "DigitalTraceabilityEvent",
  ];

  return credential.type.find((t) => types.includes(t)) || "Unknown";
}

export function detectVersion(credential: Credential): string {
  const contextUrl = credential["@context"].find((ctx) =>
    ctx.includes("vocabulary.uncefact.org")
  );

  if (!contextUrl) return "unknown";

  const versionMatch = contextUrl.match(/\/(\d+\.\d+\.\d+)\//);
  return versionMatch ? versionMatch[1] : "unknown";
}

export function isEnvelopedProof(credential: any): boolean {
  const normalizedCredential = credential.verifiableCredential || credential;

  return normalizedCredential.type === "EnvelopedVerifiableCredential";
}
