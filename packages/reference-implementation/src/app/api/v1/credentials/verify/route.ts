import { NextResponse } from 'next/server';
import { apiLogger } from '@/lib/api/logger';
import { ValidationError } from '@/lib/api/validation';
import { withPublicRoute } from '@/lib/api/with-public-route';
import { SYSTEM_TENANT_ID } from '@/lib/prisma/constants';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import { computeHash, decryptCredential } from '@uncefact/untp-ri-services';
import type { EncryptionAlgorithm, EnvelopedVerifiableCredential } from '@uncefact/untp-ri-services';
import { decodeJwt } from 'jose';

const logger = apiLogger.child({ route: '/api/v1/credentials/verify' });

const HEX_64 = /^[a-f0-9]{64}$/i;
const DEFAULT_MAX_CREDENTIAL_SIZE = 10_485_760; // 10 MB

function getMaxCredentialSize(): number {
  const envVal = process.env.VERIFY_MAX_CREDENTIAL_SIZE;
  if (!envVal) return DEFAULT_MAX_CREDENTIAL_SIZE;
  const parsed = parseInt(envVal, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CREDENTIAL_SIZE;
}

/**
 * @swagger
 * /api/v1/credentials/verify:
 *   post:
 *     summary: Verify a credential
 *     description: |
 *       Fetches a verifiable credential from the given storage URI, optionally
 *       decrypts it, checks its integrity hash, and verifies the credential
 *       signature via the system VC service.
 *
 *       This is an unauthenticated endpoint — no bearer token is required.
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
 *               hash:
 *                 type: string
 *                 pattern: '^[a-fA-F0-9]{64}$'
 *                 description: Expected SHA-256 hash (64-character hex string)
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
 *         description: Upstream storage error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   enum: [UPSTREAM_ERROR]
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
  let body: { uri?: string; hash?: string; decryptionKey?: string };
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  if (!body.uri || typeof body.uri !== 'string') {
    throw new ValidationError('uri is required');
  }

  let parsedUri: URL;
  try {
    parsedUri = new URL(body.uri);
  } catch {
    throw new ValidationError('uri must be a valid URL');
  }

  if (parsedUri.protocol !== 'http:' && parsedUri.protocol !== 'https:') {
    throw new ValidationError('uri must be a valid HTTP(S) URL');
  }

  if (body.hash !== undefined && (typeof body.hash !== 'string' || !HEX_64.test(body.hash))) {
    throw new ValidationError('hash must be a 64-character hex string (SHA-256)');
  }

  if (
    body.decryptionKey !== undefined &&
    (typeof body.decryptionKey !== 'string' || !HEX_64.test(body.decryptionKey))
  ) {
    throw new ValidationError('decryptionKey must be a 64-character hex string');
  }

  // ── Step 2: Fetch credential from storage URI ──────────────────────
  // NOTE: Production deployments should consider SSRF protection (e.g., blocking private IP
  // ranges at the infrastructure/reverse-proxy level).
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
  } catch {
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
    return NextResponse.json(
      { error: 'Response from storage URI is not valid JSON', code: 'INVALID_RESPONSE' },
      { status: 422 },
    );
  }

  // ── Step 3: Detect and handle encryption ───────────────────────────
  const isEncrypted =
    typeof fetchedData === 'object' &&
    fetchedData !== null &&
    'cipherText' in fetchedData &&
    'iv' in fetchedData &&
    'tag' in fetchedData &&
    'type' in fetchedData;

  let credential: Record<string, unknown>;

  if (isEncrypted) {
    if (!body.decryptionKey) {
      logger.info('Encrypted credential but no decryption key provided');
      return NextResponse.json(
        { error: 'Credential is encrypted but no decryptionKey was provided', code: 'DECRYPTION_REQUIRED' },
        { status: 422 },
      );
    }

    logger.info('Decrypting credential');
    const encrypted = fetchedData as { cipherText: string; iv: string; tag: string; type: string };
    try {
      const decryptedString = decryptCredential({
        cipherText: encrypted.cipherText,
        key: body.decryptionKey,
        iv: encrypted.iv,
        tag: encrypted.tag,
        type: encrypted.type as EncryptionAlgorithm,
      });
      credential = JSON.parse(decryptedString);
    } catch {
      logger.warn('Credential decryption failed');
      return NextResponse.json({ error: 'Failed to decrypt credential', code: 'DECRYPTION_FAILED' }, { status: 422 });
    }
  } else {
    credential = fetchedData as Record<string, unknown>;
  }

  // ── Step 4: Hash verification ──────────────────────────────────────
  if (body.hash) {
    logger.info('Verifying credential hash');
    const computed = computeHash(credential);
    if (computed !== body.hash) {
      logger.warn({ expected: body.hash, computed }, 'Hash mismatch');
      return NextResponse.json(
        { error: 'Credential hash does not match the expected hash', code: 'HASH_MISMATCH' },
        { status: 422 },
      );
    }
    logger.info('Hash verification passed');
  }

  // ── Step 5: Validate credential type ───────────────────────────────
  if (credential.type !== 'EnvelopedVerifiableCredential') {
    return NextResponse.json(
      { error: 'Only EnvelopedVerifiableCredential is supported', code: 'UNSUPPORTED_CREDENTIAL_TYPE' },
      { status: 422 },
    );
  }

  // ── Step 6: Verify credential via VC service ───────────────────────
  logger.info('Resolving system default VC service');
  const { service: vcService } = await resolveVcService(SYSTEM_TENANT_ID);

  logger.info('Verifying credential');
  const result = await vcService.verify(credential as unknown as EnvelopedVerifiableCredential);

  // ── Step 7: Decode JWT from enveloped credential ───────────────────
  let decodedCredential: Record<string, unknown> | undefined;
  try {
    const jwt = (credential.id as string).replace('data:application/vc+jwt,', '');
    decodedCredential = decodeJwt(jwt) as unknown as Record<string, unknown>;
  } catch {
    logger.warn('Failed to decode JWT from enveloped credential');
  }

  // ── Step 8: Return result ──────────────────────────────────────────
  if (result.verified) {
    logger.info('Credential verification passed');
    return NextResponse.json({
      verified: true,
      credential,
      ...(decodedCredential && { decodedCredential }),
    });
  }

  logger.info({ errorType: result.error?.type }, 'Credential verification failed');
  return NextResponse.json({
    verified: false,
    error: result.error,
    credential,
    ...(decodedCredential && { decodedCredential }),
  });
});
