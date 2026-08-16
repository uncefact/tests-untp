import { TextDecoder } from 'node:util';
import { NextResponse } from 'next/server';
import { apiLogger } from '@/lib/api/logger';
import { ValidationError } from '@/lib/api/validation';
import { withPublicRoute } from '@/lib/api/with-public-route';
import { SYSTEM_TENANT_ID } from '@/lib/prisma/constants';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import {
  decryptCredential,
  hasValidEnvelopeStructure,
  isEncryptedEnvelope,
  VcVerifyError,
} from '@uncefact/untp-ri-services';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  resolveDocument,
  ResolverError,
  ResolverHttpError,
  ResolverTimedOutError,
  ResolverTooLargeError,
} from '@uncefact/untp-utils/resolvers';
import { UrlValidationError } from '@uncefact/untp-utils/node';
import type { EnvelopedVerifiableCredential, VerifyResult } from '@uncefact/untp-ri-services';
import { decodeJwt } from 'jose';

const logger = apiLogger.child({ route: '/api/v1/credentials/verify' });

const HEX_64 = /^[a-f0-9]{64}$/i;
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
 *       Decryption happens server-side, so a `decryptionKey` travels in the
 *       request body. Production deployments must serve this endpoint over
 *       HTTPS so the key is protected in transit.
 *
 *       SSRF protection: the URI is fetched through a guarded resolver that
 *       validates the hostname against private/reserved ranges on every
 *       redirect hop and pins the connection to the validated address, so
 *       neither a redirect nor a DNS change between check and connect can
 *       reach a private network. Set `VERIFY_ALLOW_PRIVATE_URLS=true` to
 *       bypass (development only).
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
 *                     - ENVELOPE_INVALID
 *                     - DECRYPTION_FAILED
 *                     - DECRYPTED_NOT_JSON
 *                     - DIGEST_MISMATCH
 *                     - UNSUPPORTED_CREDENTIAL_TYPE
 *                   description: |
 *                     `DECRYPTION_REQUIRED`: the credential is encrypted and no
 *                     `decryptionKey` was supplied.
 *                     `ENVELOPE_INVALID`: the stored encrypted envelope is
 *                     structurally corrupted (wrong IV or auth-tag length);
 *                     re-supplying the key will not help.
 *                     `DECRYPTION_FAILED`: the decryption key does not match
 *                     the credential. This is almost always a wrong key, but
 *                     AES-GCM cannot distinguish a wrong key from ciphertext
 *                     tampered at valid lengths.
 *                     `DECRYPTED_NOT_JSON`: decryption succeeded but the
 *                     content is not valid JSON, so the stored credential is
 *                     corrupted.
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
  logger.info('Parsing request body');
  let body: { uri?: string; digestMultibase?: string; hash?: string; decryptionKey?: string };
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ uri: body.uri }, 'Validating input parameters');

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

  if (body.digestMultibase !== undefined) {
    if (typeof body.digestMultibase !== 'string') {
      throw new ValidationError('digestMultibase must be a string');
    }
    try {
      MultibaseDigest.fromString(body.digestMultibase);
    } catch {
      throw new ValidationError('digestMultibase must be a valid multibase-encoded multihash');
    }
  }

  // Accept the legacy `hash` query parameter (hex SHA-256) for verify URLs
  // already issued before the multibase migration; they're out in the wild on
  // QR codes and can't be reissued. Prefer `digestMultibase` when both are set.
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
  // The guarded resolver validates the hostname against private/reserved
  // ranges on every redirect hop and pins the connection to the validated
  // address, closing the redirect-following and DNS-rebinding gaps a
  // validate-then-fetch sequence leaves open. VERIFY_ALLOW_PRIVATE_URLS=true
  // (development only) falls back to a plain fetch so private storage hosts
  // in local compose setups keep working.
  logger.info({ uri: body.uri }, 'Fetching credential from storage');

  const maxSize = getMaxCredentialSize();
  let responseText: string;

  if (process.env.VERIFY_ALLOW_PRIVATE_URLS === 'true') {
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

    try {
      responseText = await fetchResponse.text();
    } catch (e: unknown) {
      logger.warn({ uri: body.uri, err: e }, 'Failed to read credential response body');
      return NextResponse.json(
        { error: 'Failed to read credential response', code: 'UPSTREAM_ERROR' },
        { status: 502 },
      );
    }

    if (responseText.length > maxSize) {
      return NextResponse.json(
        { error: `Credential response exceeds maximum size of ${maxSize} bytes`, code: 'UPSTREAM_ERROR' },
        { status: 502 },
      );
    }
  } else {
    try {
      const resolved = await resolveDocument(body.uri, { maxResponseBytes: maxSize, totalTimeoutMs: 10_000 });
      responseText = new TextDecoder().decode(resolved.body);
    } catch (e: unknown) {
      if (e instanceof UrlValidationError) {
        throw new ValidationError(e.message);
      }
      if (e instanceof ResolverTooLargeError) {
        return NextResponse.json(
          { error: `Credential response exceeds maximum size of ${maxSize} bytes`, code: 'UPSTREAM_ERROR' },
          { status: 502 },
        );
      }
      if (e instanceof ResolverHttpError) {
        const message = `Failed to fetch credential: storage returned ${e.status}`;
        logger.warn({ uri: body.uri, status: e.status }, 'Credential fetch failed');
        return NextResponse.json({ error: message, code: 'UPSTREAM_ERROR' }, { status: 502 });
      }
      if (e instanceof ResolverTimedOutError) {
        logger.warn({ uri: body.uri }, 'Credential fetch timed out');
        return NextResponse.json(
          { error: 'Failed to fetch credential: request timed out', code: 'UPSTREAM_ERROR' },
          { status: 502 },
        );
      }
      if (e instanceof ResolverError) {
        logger.warn({ uri: body.uri, err: e }, 'Credential fetch failed');
        return NextResponse.json(
          { error: 'Failed to fetch credential: network error', code: 'UPSTREAM_ERROR' },
          { status: 502 },
        );
      }
      throw e;
    }
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

  let credential: Record<string, unknown>;

  if (isEncryptedEnvelope(fetchedData)) {
    if (!body.decryptionKey) {
      logger.info('Encrypted credential but no decryption key provided');
      return NextResponse.json(
        { error: 'Credential is encrypted but no decryptionKey was provided', code: 'DECRYPTION_REQUIRED' },
        { status: 422 },
      );
    }

    // Structural validity must be checked before decryption: Node's AES-GCM
    // throws the same error for a wrong-length IV/tag as for a wrong key, so
    // corruption is only distinguishable from a key mismatch up front.
    if (!hasValidEnvelopeStructure(fetchedData)) {
      logger.warn({ uri: body.uri }, 'Encrypted envelope is structurally invalid');
      return NextResponse.json(
        {
          error: 'The stored credential data is corrupted and cannot be decrypted. Re-entering the key will not help.',
          code: 'ENVELOPE_INVALID',
        },
        { status: 422 },
      );
    }

    logger.info('Decrypting credential');
    let decryptedString: string;
    try {
      decryptedString = decryptCredential({
        cipherText: fetchedData.cipherText,
        key: body.decryptionKey,
        iv: fetchedData.iv,
        tag: fetchedData.tag,
        type: fetchedData.type,
      });
    } catch (e: unknown) {
      logger.warn({ uri: body.uri, err: e }, 'Credential decryption failed');
      return NextResponse.json(
        {
          error: 'The decryption key does not match this credential. Check the key and try again.',
          code: 'DECRYPTION_FAILED',
        },
        { status: 422 },
      );
    }

    try {
      credential = JSON.parse(decryptedString);
    } catch {
      logger.warn({ uri: body.uri }, 'Decrypted credential is not valid JSON');
      return NextResponse.json(
        {
          error:
            'The credential was decrypted but its content is not valid JSON; the stored credential data is corrupted.',
          code: 'DECRYPTED_NOT_JSON',
        },
        { status: 422 },
      );
    }
  } else {
    credential = fetchedData as Record<string, unknown>;
  }

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
