import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';

import {
  VCKitAdapter,
  UNCEFACTStorageAdapter,
  StorageRecord,
  CredentialIssuer,
  CredentialPayload,
  CredentialSubject,
  UNTPVerifiableCredential,
  RenderMethod,
  VC_CONTEXT_V2,
  VC_TYPE,
} from '@uncefact/untp-ri-services';
import { createCredential } from '@/lib/prisma/repositories';

type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | JSONObject | JSONArray;
type JSONObject = { [key: string]: JSONValue };
type JSONArray = JSONValue[];

/**
 * Incoming POST request payload
 */
type IssueRequest = {
  formData: CredentialSubject;
  publish?: boolean;
};

/**
 * Digital Product Passport configuration
 */
type DppConfig = {
  context: string[];
  type: string[];
  renderTemplate: RenderMethod[];
  validUntil?: string;
  validFrom?: string;
  dlrLinkTitle: string;
  dlrVerificationPage: string;
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
  vckit: {
    vckitAPIUrl: string;
    issuer: CredentialIssuer;
    headers?: Record<string, string>;
  };
  dpp: DppConfig;
  storage: {
    url: string;
    params: { bucket: string };
    options: {
      method: string;
      headers?: Record<string, string>;
    };
  };
  dlr: DlrConfig;
};

type AppConfig = {
  services: Array<{
    parameters: IssueConfigParams[];
  }>;
};

/**
 * Creates the verifiable credential service adapter
 */
function createVCService(): VCKitAdapter {
  const baseURL = process.env.ISSUER_API_URL;
  if (!baseURL) {
    throw new Error('ISSUER_API_URL environment variable is required');
  }
  const authToken = process.env.ISSUER_AUTH_TOKEN;
  if (!authToken) {
    throw new Error('ISSUER_AUTH_TOKEN environment variable is required');
  }
  const headers = { Authorization: `Bearer ${authToken}` };
  return new VCKitAdapter(baseURL, headers);
}

/**
 * Creates the storage service adapter
 */
function createStorageService(params: IssueConfigParams): UNCEFACTStorageAdapter {
  const baseURL = process.env.STORAGE_SERVICE_URL;
  if (!baseURL) {
    throw new Error('STORAGE_SERVICE_URL environment variable is required');
  }
  const apiKey = process.env.STORAGE_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error('STORAGE_AUTH_TOKEN environment variable is required');
  }
  const headers = { 'X-API-Key': apiKey };
  const { params: storageParams } = params.storage;
  return new UNCEFACTStorageAdapter(baseURL, headers, storageParams.bucket);
}

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
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate form data
  if (!body.formData || typeof body.formData !== 'object') {
    return NextResponse.json({ ok: false, error: 'formData must be a JSON object' }, { status: 400 });
  }

  const shouldPublish = typeof body.publish === 'boolean' ? body.publish : false;

  try {
    const config = await getConfig();
    const params = getConfigParameters(config);

    // Create service adapters
    const vcService = createVCService();
    const storageService = createStorageService(params);

    // Build credential payload
    const credentialPayload: CredentialPayload = {
      '@context': [VC_CONTEXT_V2, ...params.dpp.context],
      type: [VC_TYPE, ...params.dpp.type],
      issuer: params.vckit.issuer,
      credentialSubject: body.formData,
      renderMethod: params.dpp.renderTemplate,
      validUntil: params.dpp.validUntil,
    };

    // Issue VC using the adapter
    const envelopedVC = await vcService.sign(credentialPayload);

    // Decode the enveloped VC
    const decodedCredential = await vcService.decode(envelopedVC);

    // Store VC (enveloped format) using the adapter
    const storageResponse = await storageService.store(envelopedVC);

    // Optionally publish VC
    const publishResponse = shouldPublish
      ? await publishCredential(params, decodedCredential, storageResponse)
      : { enabled: false };

    // Save credential record to database
    const credentialType = decodedCredential.type?.[1] ?? 'VerifiableCredential';

    const credentialRecord = await createCredential({
      storageUri: storageResponse.uri,
      hash: storageResponse.hash,
      decryptionKey: storageResponse.decryptionKey,
      credentialType,
      isPublished: shouldPublish,
    });

    return NextResponse.json({
      ok: true,
      storageResponse,
      publishResponse,
      credential: decodedCredential,
      credentialId: credentialRecord.id,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'An unexpected error has occurred.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/*
 * Publishes credential to the Digital Link Resolver
 */
async function publishCredential(
  params: IssueConfigParams,
  decodedCredential: UNTPVerifiableCredential,
  storage: StorageRecord,
): Promise<{ enabled: true; raw: JSONValue }> {
  const dlr = params.dlr;
  const idrAPIUrl = process.env.IDR_API_URL || dlr.dlrAPIUrl;
  const idrAPIKey = process.env.IDR_API_KEY || dlr.dlrAPIKey;

  if (!storage?.uri) throw new Error('Storage response missing uri');
  if (!storage?.hash) throw new Error('Storage response missing hash');

  const credentialSubject = decodedCredential.credentialSubject;
  const subject = Array.isArray(credentialSubject) ? credentialSubject[0] : credentialSubject;
  const identificationKey = (subject as { registeredId?: string })?.registeredId;

  if (!identificationKey) {
    throw new Error('Missing credentialSubject.registeredId');
  }

  const DEFAULT_MACHINE_VERIFICATION_URL = process.env.DEFAULT_MACHINE_VERIFICATION_URL!;
  const DEFAULT_HUMAN_VERIFICATION_URL = process.env.DEFAULT_HUMAN_VERIFICATION_URL!;

  const baseResponses = [
    {
      linkType: 'gs1:verificationService',
      title: 'VCKit verify service',
      targetUrl: DEFAULT_MACHINE_VERIFICATION_URL,
      mimeType: 'text/plain',
    },
    {
      linkType: 'gs1:sustainabilityInfo',
      title: 'Product Passport',
      targetUrl: storage.uri,
      mimeType: 'application/json',
    },
    {
      linkType: 'gs1:sustainabilityInfo',
      title: 'Product Passport',
      targetUrl: constructVerifyURL({
        baseUrl: DEFAULT_HUMAN_VERIFICATION_URL,
        uri: storage.uri,
        hash: storage.hash,
      }),
      mimeType: 'text/html',
    },
  ];

  const contexts = ['au', 'us'];

  const responses = contexts.flatMap((context) =>
    baseResponses.map((response) => ({
      ...response,
      context,
      ianaLanguage: 'en',
      defaultLinkType: false,
      defaultIanaLanguage: false,
      defaultContext: false,
      defaultMimeType: false,
      fwqs: false,
      active: true,
    })),
  );

  const payload = {
    namespace: dlr.namespace,
    link: storage.uri,
    title: params.dpp.dlrLinkTitle,
    verificationPage: params.dpp.dlrVerificationPage,
    identificationKey,
    identificationKeyType: '01',
    itemDescription: params.dpp.dlrLinkTitle,
    qualifierPath: '/',
    active: true,
    responses,
  };

  const res = await fetch(`${idrAPIUrl}/${dlr.linkRegisterPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idrAPIKey}`,
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
 * Loads configuration from mounted volume or falls back to built-in config
 */
async function getConfig(): Promise<AppConfig> {
  // Runtime config path (mounted volume)
  const runtimeConfigPath = process.env.CONFIG_PATH || '/app/config/app-config.json';
  // Built-in fallback config
  const builtInConfigPath = path.join(process.cwd(), 'src/constants/app-config.issue.json');

  // Try runtime config first
  try {
    const raw = await readFile(runtimeConfigPath, 'utf-8');
    return JSON.parse(raw) as AppConfig;
  } catch (err) {
    console.log(
      `Runtime config not found or failed to load from ${runtimeConfigPath}. Falling back to built-in config. Error: ${
        err instanceof Error ? err.message : 'Unknown error'
      }`,
    );
    // Fall back to built-in config
  }

  // Try built-in config
  try {
    const raw = await readFile(builtInConfigPath, 'utf-8');
    return JSON.parse(raw) as AppConfig;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Failed to load config file: ${message}`);
  }
}

/**
 * Extracts service parameters from config
 */
function getConfigParameters(config: AppConfig): IssueConfigParams {
  const params = config?.services?.[0]?.parameters?.[0];
  if (!params) throw new Error('Invalid config: missing services[0].parameters[0]');
  return params;
}

/**
 * Builds verification URL with embedded query payload
 */
function constructVerifyURL(opts: { baseUrl: string; uri: string; hash: string; key?: string }) {
  const { baseUrl, uri, hash, key } = opts;
  if (!uri || !hash) throw new Error('URI and hash are required');

  const payload: Record<string, string> = { uri, hash };
  if (key) payload.key = key;

  const queryString = `q=${encodeURIComponent(JSON.stringify({ payload }))}`;
  return `${baseUrl}/verify?${queryString}`;
}
