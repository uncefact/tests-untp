import { NextResponse } from 'next/server';
import { apiLogger } from '@/lib/api/logger';
import { ValidationError, parseRequestBody } from '@/lib/api/validation';
import { verifyCredentialRequestSchema } from '@/lib/api/request-schemas/credential';
import { withPublicRoute } from '@/lib/api/with-public-route';
import { SYSTEM_TENANT_ID } from '@/lib/prisma/constants';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import { decryptCredential, isEncryptedEnvelope, VcVerifyError } from '@uncefact/untp-ri-services';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { validatePublicUrl } from '@uncefact/untp-ri-services/server';
import type { EnvelopedVerifiableCredential, VerifyResult } from '@uncefact/untp-ri-services';
import { decodeJwt } from 'jose';

const logger = apiLogger.child({ route: '/api/v1/credentials/verify' });

const JWT_PREFIX = 'data:application/vc+jwt,';
const DEFAULT_MAX_CREDENTIAL_SIZE = 10_485_760; // 10 MB

function getMaxCredentialSize(): number {
  const envVal = process.env.VERIFY_MAX_CREDENTIAL_SIZE;
  if (!envVal) return DEFAULT_MAX_CREDENTIAL_SIZE;
  const parsed = parseInt(envVal, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CREDENTIAL_SIZE;
}

/**
 * @swagger
 * /credentials/verify:
 *   post:
 *     summary: Verify a credential
 *     description: |
 *       Fetches a verifiable credential from the given storage URI, optionally
 *       decrypts it, checks its integrity hash, and verifies the credential
 *       signature via the system VC service.
 *
 *       This is an unauthenticated endpoint — no bearer token is required.
 *
 *       SSRF protection: the URI hostname is resolved via DNS and the
 *       resolved IP is checked against private/reserved ranges. Set
 *       `VERIFY_ALLOW_PRIVATE_URLS=true` to bypass (development only).
 *     tags:
 *       - Credentials
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - uri
 *             properties:
 *               uri:
 *                 type: string
 *                 format: uri
 *                 description: Storage URI where the credential is stored
 *                 example: https://storage.example.com/credentials/abc123
 *               digestMultibase:
 *                 type: string
 *                 description: Expected multibase-encoded multihash digest of the credential content
 *                 example: zQmExampleBase58btcMultihash
 *               hash:
 *                 type: string
 *                 pattern: '^[a-fA-F0-9]{64}$'
 *                 description: |
 *                   Expected SHA-256 hash (64-character hex string). Accepted
 *                   for backwards compatibility with verify URLs already in
 *                   the wild that were issued before the multibase migration.
 *                   New URLs should use `digestMultibase` instead.
 *               decryptionKey:
 *                 type: string
 *                 pattern: '^[a-fA-F0-9]{64}$'
 *                 description: AES-256-GCM decryption key (64-character hex string)
 *     responses:
 *       200:
 *         description: Verification completed (check `verified` field for outcome)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verified:
 *                   type: boolean
 *                 credential:
 *                   type: object
 *                   description: The enveloped credential object
 *                 decodedCredential:
 *                   type: object
 *                   description: Decoded JWT payload (omitted if decoding fails)
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Non-fatal issues (e.g. JWT decode failure)
 *                 error:
 *                   type: object
 *                   description: Present only when verified is false
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [status, integrity, temporal]
 *                     message:
 *                       type: string
 *       400:
 *         description: Validation error (missing or malformed input)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Credential processing error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   enum:
 *                     - INVALID_RESPONSE
 *                     - DECRYPTION_REQUIRED
 *                     - DECRYPTION_FAILED
 *                     - HASH_MISMATCH
 *                     - UNSUPPORTED_CREDENTIAL_TYPE
 *       502:
 *         description: Upstream service error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   enum: [UPSTREAM_ERROR, VC_SERVICE_ERROR]
 *       500:
 *         description: Server error (e.g. system VC service not configured)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const POST = withPublicRoute(async (req) => {
  // TODO: Production deployments should implement rate limiting at the infrastructure level
  // (reverse proxy, API gateway, CDN). In-memory rate limiting in a Next.js API route
  // is fragile across serverless instances.

  // ── Step 1: Parse and validate input ────────────────────────────────
  // The schema accepts the legacy `hash` field (hex SHA-256) for verify URLs
  // already issued before the multibase migration; they're out in the wild on
  // QR codes and can't be reissued. Prefer `digestMultibase` when both are set.
  logger.info('Parsing and validating request body');
  const body = await parseRequestBody(req, verifyCredentialRequestSchema);

  let parsedUri: URL;
  try {
    parsedUri = new URL(body.uri);
  } catch {
    throw new ValidationError('uri must be a valid URL');
  }

  if (parsedUri.protocol !== 'http:' && parsedUri.protocol !== 'https:') {
    throw new ValidationError('uri must be a valid HTTP(S) URL');
  }

  // ── SSRF protection: block private/reserved network addresses ──────
  if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
    try {
      await validatePublicUrl(parsedUri);
    } catch (e) {
      throw new ValidationError(
        e instanceof Error ? e.message : 'uri must not point to a private or reserved network address',
      );
    }
  }

  // ── Step 2: Fetch credential from storage URI ──────────────────────
  logger.info({ uri: body.uri }, 'Fetching credential from storage');

  let fetchResponse: Response;
  try {
    fetchResponse = await fetch(body.uri, { signal: AbortSignal.timeout(10_000) });
  } catch (e: unknown) {
    const message =
      e instanceof Error && e.name === 'TimeoutError'
        ? 'Failed to fetch credential: request timed out'
        : 'Failed to fetch credential: network error';
    logger.warn({ uri: body.uri, error: message }, 'Credential fetch failed');
    return NextResponse.json({ error: message, code: 'UPSTREAM_ERROR' }, { status: 502 });
  }

  if (!fetchResponse.ok) {
    const message = `Failed to fetch credential: storage returned ${fetchResponse.status}`;
    logger.warn({ uri: body.uri, status: fetchResponse.status }, 'Credential fetch failed');
    return NextResponse.json({ error: message, code: 'UPSTREAM_ERROR' }, { status: 502 });
  }

  let responseText: string;
  try {
    responseText = await fetchResponse.text();
  } catch (e: unknown) {
    logger.warn({ uri: body.uri, err: e }, 'Failed to read credential response body');
    return NextResponse.json({ error: 'Failed to read credential response', code: 'UPSTREAM_ERROR' }, { status: 502 });
  }

  const maxSize = getMaxCredentialSize();
  if (responseText.length > maxSize) {
    return NextResponse.json(
      { error: `Credential response exceeds maximum size of ${maxSize} bytes`, code: 'UPSTREAM_ERROR' },
      { status: 502 },
    );
  }

  let fetchedData: unknown;
  try {
    fetchedData = JSON.parse(responseText);
  } catch {
    logger.warn({ uri: body.uri }, 'Storage URI returned non-JSON response');
    return NextResponse.json(
      { error: 'Response from storage URI is not valid JSON', code: 'INVALID_RESPONSE' },
      { status: 422 },
    );
  }

  // ── Step 3: Detect and handle encryption ───────────────────────────
  logger.info('Detecting credential encryption');

  let credentialData: unknown;

  if (isEncryptedEnvelope(fetchedData)) {
    if (!body.decryptionKey) {
      logger.info('Encrypted credential but no decryption key provided');
      return NextResponse.json(
        { error: 'Credential is encrypted but no decryptionKey was provided', code: 'DECRYPTION_REQUIRED' },
        { status: 422 },
      );
    }

    logger.info('Decrypting credential');
    try {
      const decryptedString = decryptCredential({
        cipherText: fetchedData.cipherText,
        key: body.decryptionKey,
        iv: fetchedData.iv,
        tag: fetchedData.tag,
        type: fetchedData.type,
      });
      credentialData = JSON.parse(decryptedString);
    } catch (e: unknown) {
      logger.warn({ uri: body.uri, err: e }, 'Credential decryption failed');
      return NextResponse.json({ error: 'Failed to decrypt credential', code: 'DECRYPTION_FAILED' }, { status: 422 });
    }
  } else {
    credentialData = fetchedData;
  }

  // A stored JSON scalar (including null) or array is not a credential;
  // reject it before any property access.
  if (credentialData === null || typeof credentialData !== 'object' || Array.isArray(credentialData)) {
    logger.warn({ uri: body.uri }, 'Credential content is not a JSON object');
    return NextResponse.json(
      { error: 'Credential content is not a JSON object', code: 'INVALID_RESPONSE' },
      { status: 422 },
    );
  }

  const credential = credentialData as Record<string, unknown>;

  // ── Step 4: Digest verification ────────────────────────────────────
  // Prefer the multibase digest when provided; fall back to the legacy hex
  // hash for verify URLs issued before the migration. Both compare against
  // the same credential bytes.
  if (body.digestMultibase || body.hash) {
    const credentialBytes = new TextEncoder().encode(JSON.stringify(credential));

    if (body.digestMultibase) {
      logger.info('Verifying credential digestMultibase');
      const expected = MultibaseDigest.fromString(body.digestMultibase);
      const matches = await expected.verify(credentialBytes);
      if (!matches) {
        logger.warn({ expected: body.digestMultibase }, 'Digest mismatch');
        return NextResponse.json(
          { error: 'Credential digest does not match the expected digest', code: 'DIGEST_MISMATCH' },
          { status: 422 },
        );
      }
      logger.info('Digest verification passed');
    } else if (body.hash) {
      logger.info('Verifying credential legacy hex hash');
      const digestBuffer = await crypto.subtle.digest('SHA-256', credentialBytes);
      const computed = Array.from(new Uint8Array(digestBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      if (computed !== body.hash) {
        logger.warn({ expected: body.hash, computed }, 'Digest mismatch');
        return NextResponse.json(
          { error: 'Credential digest does not match the expected digest', code: 'DIGEST_MISMATCH' },
          { status: 422 },
        );
      }
      logger.info('Digest verification passed');
    }
  }

  // ── Step 5: Validate credential type ───────────────────────────────
  logger.info({ credentialType: credential.type }, 'Validating credential type');
  const types = Array.isArray(credential.type) ? credential.type : [credential.type];
  if (!types.includes('EnvelopedVerifiableCredential')) {
    logger.warn({ uri: body.uri, credentialType: credential.type }, 'Unsupported credential type');
    return NextResponse.json(
      { error: 'Only EnvelopedVerifiableCredential is supported', code: 'UNSUPPORTED_CREDENTIAL_TYPE' },
      { status: 422 },
    );
  }

  // ── Step 6: Verify credential via VC service ───────────────────────
  logger.info('Resolving system default VC service');
  const { service: vcService } = await resolveVcService(SYSTEM_TENANT_ID);

  logger.info('Verifying credential');
  let result: VerifyResult;
  try {
    result = await vcService.verify(credential as unknown as EnvelopedVerifiableCredential);
  } catch (e: unknown) {
    if (e instanceof VcVerifyError) {
      logger.error({ err: e }, 'VC service verification failed');
      return NextResponse.json(
        { error: 'Credential verification service failed', code: 'VC_SERVICE_ERROR' },
        { status: 502 },
      );
    }
    throw e;
  }

  // ── Step 7: Decode JWT from enveloped credential ───────────────────
  const warnings: string[] = [];
  let decodedCredential: Record<string, unknown> | undefined;

  logger.info('Decoding JWT from enveloped credential');
  const credentialId = credential.id;
  if (typeof credentialId !== 'string') {
    logger.warn({ credentialIdType: typeof credentialId }, 'Credential id is not a string');
    warnings.push('Credential id is not a string; unable to decode JWT');
  } else if (!credentialId.startsWith(JWT_PREFIX)) {
    logger.warn('Credential id does not use the expected data:application/vc+jwt media type');
    warnings.push('Credential id does not use the expected data:application/vc+jwt media type');
  } else {
    try {
      const jwt = credentialId.substring(JWT_PREFIX.length);
      decodedCredential = decodeJwt(jwt) as unknown as Record<string, unknown>;
    } catch (e: unknown) {
      logger.warn({ err: e }, 'Failed to decode JWT from enveloped credential');
      warnings.push('Failed to decode JWT from enveloped credential');
    }
  }

  // ── Step 8: Return result ──────────────────────────────────────────
  logger.info({ verified: result.verified }, 'Credential verification complete');

  const responseBody: Record<string, unknown> = {
    verified: result.verified,
    credential,
    ...(decodedCredential && { decodedCredential }),
    ...(warnings.length > 0 && { warnings }),
  };

  if (!result.verified) {
    responseBody.error = result.error;
  }

  return NextResponse.json(responseBody, { status: 200 });
});
