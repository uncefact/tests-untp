import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

type IssueRequest = {
  formData: Record<string, any>;
  publish: boolean;
};

type VCkitConfig = {
  vckitAPIUrl: string;
  issuer: any;
  headers?: Record<string, string>;
};

type DppConfig = {
  context: string[];
  type: string[];
  renderTemplate: any;
  validUntil?: string;
  validFrom?: string;
  dlrLinkTitle: string;
  dlrVerificationPage: string;
};

type StorageConfig = {
  url: string;
  params: { bucket: string };
  options: {
    method: string;
    headers?: Record<string, string>;
  };
};

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

type SignedCredential = {
  verifiableCredential?: {
    credentialSubject?: {
      registeredId?: string;
    };
  };
  [key: string]: any;
};

type StorageResponse = {
  uri: string;
  key?: string;
  hash?: string;
  [key: string]: any;
};

export async function POST(req: Request) {
  let body: IssueRequest;

  try {
    body = (await req.json()) as IssueRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.formData || typeof body.formData !== "object") {
    return NextResponse.json({ ok: false, error: "formData must be a JSON object" }, { status: 400 });
  }

  const shouldPublish = typeof body.publish === "boolean" ? body.publish : false;

  try {
    const config = await getConfig();

    const signedCredential = await issueCredential(config, body);

    const storageResponse = await storeCredential(config, signedCredential);

    const publishResponse = shouldPublish
      ? await publishCredential(config, signedCredential, storageResponse)
      : { enabled: false };

      return NextResponse.json({ ok: true, storageResponse, publishResponse, signedCredential });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "An unexpected error has occurred." }, { status: 500 });
  }
}

async function issueCredential(config: AppConfig, body: IssueRequest): Promise<SignedCredential> {
  const params = getConfigParameters(config);
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

async function storeCredential(config: AppConfig, signedCredential: SignedCredential): Promise<StorageResponse> {
  const params = getConfigParameters(config);
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

async function publishCredential(
  config: AppConfig,
  signedCredential: SignedCredential,
  storage: StorageResponse
): Promise<{ enabled: true; raw: any }> {
  const params = getConfigParameters(config);
  const dlr = params.dlr;

  const namespace = dlr.namespace;
  const linkTitle = params.dpp.dlrLinkTitle;
  const verificationPage = params.dpp.dlrVerificationPage;

  if (!storage?.uri) throw new Error("Storage response missing uri");

  const identificationKey = signedCredential.verifiableCredential?.credentialSubject?.registeredId;
  if (!identificationKey) {
    throw new Error("Missing credentialSubject.registeredId");
  }


  const baseResponses = [
    {
      linkType: "gs1:verificationService",
      title: "VCKit verify service",
      targetUrl: verificationPage,
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
        baseUrl: verificationPage,
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
                                       ianaLanguage: 'en',
                                       context: 'us',
                                       defaultLinkType: false,
                                       defaultIanaLanguage: false,
                                       defaultContext: false,
                                       defaultMimeType: false,
                                       fwqs: false,
                                       active: true,
                                     }))
                                    );

                                    const payload = {
                                      namespace,
                                      link: storage.uri,
                                      title: linkTitle,
                                      verificationPage,
                                      identificationKey,
                                      identificationKeyType: "01",
                                      itemDescription: linkTitle,
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

function constructVerifyURL(opts: { baseUrl: string; uri: string; key?: string; hash?: string }) {
  const { baseUrl, uri, key, hash } = opts;
  if (!uri) throw new Error("URI is required");

  const payload: Record<string, any> = { uri };
  if (key) payload.key = key;
  if (hash) payload.hash = hash;

  const queryString = `q=${encodeURIComponent(JSON.stringify({ payload }))}`;
  return `${baseUrl}/verify?${queryString}`;
}

async function getConfig(): Promise<AppConfig> {
  const configPath = path.join(process.cwd(), "src/constants/app-config.issue.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as AppConfig;
  } catch (err: any) {
    throw new Error(`Failed to load config file: ${err.message}`);
  }
}

function getConfigParameters(config: AppConfig): IssueConfigParams {
  const params = config?.services?.[0]?.parameters?.[0];
  if (!params) throw new Error("Invalid config: missing services[0].parameters[0]");
  return params;
}
