import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

/**
 * Incoming POST request payload
 */
type IssueRequest = {
  formData: Record<string, any>;
  publish: boolean;
};

/**
 * VCkit service configuration
 */
type VCkitConfig = {
  vckitAPIUrl: string;
  issuer: any;
  headers?: Record<string, string>;
};

/**
 * Digital Product Passport configuration
 */
type DppConfig = {
  context: string[];
  type: string[];
  renderTemplate: any;
  validUntil?: string;
  validFrom?: string;
  dlrLinkTitle: string;
  dlrVerificationPage: string;
};

/**
 * Storage service configuration
 */
type StorageConfig = {
  url: string;
  params: { bucket: string };
  options: {
    method: string;
    headers?: Record<string, string>;
  };
};

/**
 * Digital Link Resolver configuration
 */
type DlrConfig = {
  dlrAPIUrl: string;
  linkRegisterPath: string;
  dlrAPIKey?: string;
  namespace: string;
};

type IssueConfigParams = {
  vckit: VCkitConfig;
  dpp: DppConfig;
  storage: StorageConfig;
  dlr: DlrConfig;
};

type AppConfig = {
  services: Array<{
    parameters: IssueConfigParams[];
  }>;
};

/**
 * Issued and signed verifiable credential
 */
type SignedCredential = {
  verifiableCredential?: {
    credentialSubject?: {
      registeredId?: string;
    };
  };
  [key: string]: any;
};

/**
 * Storage service response
 */
type StorageResponse = {
  uri: string;
  key?: string;
  hash?: string;
  [key: string]: any;
};

/**
 * POST handler:
 * - issues credential
 * - stores credential
 * - optionally publishes it
 */
export async function POST(req: Request) {
  let body: IssueRequest;

  // Parse request body
  try {
    body = (await req.json()) as IssueRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate form data
  if (!body.formData || typeof body.formData !== "object") {
    return NextResponse.json({ ok: false, error: "formData must be a JSON object" }, { status: 400 });
  }

  const shouldPublish = typeof body.publish === "boolean" ? body.publish : false;

  try {
    const config = await getConfig();
    const params = getConfigParameters(config);

    // Issue VC via VCkit
    const signedCredential = await issueCredential(params, body);

    // Store VC
    const storageResponse = await storeCredential(params, signedCredential);

    // Optionally publish VC
    const publishResponse = shouldPublish
      ? await publishCredential(params, signedCredential, storageResponse)
      : { enabled: false };

    return NextResponse.json({ ok: true, storageResponse, publishResponse, signedCredential });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "An unexpected error has occurred." },
      { status: 500 }
    );
  }
}

/**
 * Issues a verifiable credential using VCkit
 */
async function issueCredential(params: IssueConfigParams, body: IssueRequest): Promise<SignedCredential> {
  const vckit = params.vckit;

  const payload = {
    credential: {
      "@context": ["https://www.w3.org/ns/credentials/v2", ...params.dpp.context],
      type: ["VerifiableCredential", ...params.dpp.type],
      issuer: vckit.issuer,
      credentialSubject: body.formData,
      renderMethod: params.dpp.renderTemplate,
      validUntil: params.dpp.validUntil,
      validFrom: params.dpp.validFrom,
    },
  };

  const res = await fetch(`${vckit.vckitAPIUrl}/credentials/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(vckit.headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to issue credential with VCkit: ${res.status} ${text}`);
  }

  return (await res.json()) as SignedCredential;
}

/**
 * Stores the signed credential
 */
async function storeCredential(
  params: IssueConfigParams,
  signedCredential: SignedCredential
): Promise<StorageResponse> {
  const storage = params.storage;

  const payload = {
    bucket: storage.params.bucket,
    data: signedCredential,
  };

  const res = await fetch(storage.url, {
    method: storage.options.method,
    headers: {
      "Content-Type": "application/json",
      ...(storage.options.headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to store credential: ${res.status} ${text}`);
  }

  return (await res.json()) as StorageResponse;
}

/**
 * Publishes credential
 */
async function publishCredential(
  params: IssueConfigParams,
  signedCredential: SignedCredential,
  storage: StorageResponse
): Promise<{ enabled: true; raw: any }> {
  const params = getConfigParameters(config);
  const dlr = params.dlr;

  if (!storage?.uri) throw new Error("Storage response missing uri");

  const identificationKey =
    signedCredential.verifiableCredential?.credentialSubject?.registeredId;

  if (!identificationKey) {
    throw new Error("Missing credentialSubject.registeredId");
  }

  const baseResponses = [
    {
      linkType: "gs1:verificationService",
      title: "VCKit verify service",
      targetUrl: params.dpp.dlrVerificationPage,
      mimeType: "text/plain",
    },
    {
      linkType: "gs1:sustainabilityInfo",
      title: "Product Passport",
      targetUrl: storage.uri,
      mimeType: "application/json",
    },
    {
      linkType: "gs1:sustainabilityInfo",
      title: "Product Passport",
      targetUrl: constructVerifyURL({
        baseUrl: params.dpp.dlrVerificationPage,
        uri: storage.uri,
        key: storage.key,
        hash: storage.hash,
      }),
      mimeType: "text/html",
    },
  ];

  const contexts = ["au", "us"];

  const responses = contexts.flatMap((context) =>
    baseResponses.map((response) => ({
      ...response,
      context,
      ianaLanguage: "en",
      defaultLinkType: false,
      defaultIanaLanguage: false,
      defaultContext: false,
      defaultMimeType: false,
      fwqs: false,
      active: true,
    }))
  );

  const payload = {
    namespace: dlr.namespace,
    link: storage.uri,
    title: params.dpp.dlrLinkTitle,
    verificationPage: params.dpp.dlrVerificationPage,
    identificationKey,
    identificationKeyType: "01",
    itemDescription: params.dpp.dlrLinkTitle,
    active: true,
    responses,
  };

  const res = await fetch(`${dlr.dlrAPIUrl}/${dlr.linkRegisterPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(dlr.dlrAPIKey ? { Authorization: `Bearer ${dlr.dlrAPIKey}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Publish failed: ${res.status} ${text}`);
  }

  return { enabled: true, raw: await res.json() };
}

/**
 * Builds verification URL with embedded query payload
 */
function constructVerifyURL(opts: {
  baseUrl: string;
  uri: string;
  key?: string;
  hash?: string;
}) {
  const { baseUrl, uri, key, hash } = opts;
  if (!uri) throw new Error("URI is required");

  const payload: Record<string, any> = { uri };
  if (key) payload.key = key;
  if (hash) payload.hash = hash;

  const queryString = `q=${encodeURIComponent(JSON.stringify({ payload }))}`;
  return `${baseUrl}/verify?${queryString}`;
}

/**
 * Loads hardcoded issue configuration
 */
async function getConfig(): Promise<AppConfig> {
  const configPath = path.join(process.cwd(), "src/constants/app-config.issue.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as AppConfig;
  } catch (err: any) {
    throw new Error(`Failed to load config file: ${err.message}`);
  }
}

/**
 * Extracts service parameters
 */
function getConfigParameters(config: AppConfig): IssueConfigParams {
  const params = config?.services?.[0]?.parameters?.[0];
  if (!params) throw new Error("Invalid config: missing services[0].parameters[0]");
  return params;
}
