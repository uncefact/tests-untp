import { TextDecoder } from 'node:util';
import { NextResponse } from 'next/server';
import { apiLogger } from '@/lib/api/logger';
import { ValidationError, parseRequestBody } from '@/lib/api/validation';
import { verifyCredentialRequestSchema } from '@/lib/api/request-schemas/credential';
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
import type { EnvelopedVerifiableCredential, VerifyResult } from '@uncefact/untp-ri-services';
import { decodeJwt } from 'jose';
import {
  CredentialDocumentFetchError,
  allowsPrivateUrls,
  fetchCredentialDocument,
  getMaxCredentialSize,
  type DocumentFetchFailure,
} from '@/lib/credentials/fetch-credential-document';

const logger = apiLogger.child({ route: '/api/v1/credentials/verify' });

const JWT_PREFIX = 'data:application/vc+jwt,';

/**
 * The 502 this route returns for a failure while retrieving, worded as the
 * route always has (a resolver 304 is the one newcomer, answered like any
 * other status). Rejected inputs are this route's 400, so the parameter admits
 * only the failures that ran and the call site narrows to them; the type, not
 * a sentence, is what keeps a caller's fault out of a 502.
 */
function upstreamFailureResponse(
  failure: Extract<DocumentFetchFailure, { kind: 'failed' }>,
  uri: string,
  maxSize: number,
) {
  const respond = (error: string) => NextResponse.json({ error, code: 'UPSTREAM_ERROR' }, { status: 502 });
  switch (failure.reason) {
    case 'timeout':
      logger.warn({ uri }, 'Credential fetch timed out');
      return respond('Failed to fetch credential: request timed out');
    case 'http':
      logger.warn({ uri, status: failure.status }, 'Credential fetch failed');
      return respond(`Failed to fetch credential: storage returned ${failure.status}`);
    case 'too-large':
      logger.warn(
        { uri, maxSize, ...(failure.observedBytes !== undefined ? { size: failure.observedBytes } : {}) },
        'Credential response exceeds maximum size',
      );
      return respond(`Credential response exceeds maximum size of ${maxSize} bytes`);
    // Unreachable from the current helper, which reports an unreadable body as
    // a network failure; kept because the reason remains in the union.
    case 'body-unreadable':
      logger.warn({ uri, err: failure.error }, 'Failed to read credential response body');
      return respond('Failed to read credential response');
    case 'redirects':
      logger.warn({ uri, err: failure.error }, 'Credential fetch redirect not followed');
      return respond('Failed to fetch credential: network error');
    case 'dns':
    case 'network':
      logger.warn({ uri, err: failure.error }, 'Credential fetch failed');
      return respond('Failed to fetch credential: network error');
    default: {
      // Exhaustiveness: a new `failed` reason must choose its own answer here
      // rather than inheriting the generic network wording by default.
      const unhandled: never = failure;
      logger.warn({ uri, err: (unhandled as { error?: Error }).error }, 'Credential fetch failed');
      return respond('Failed to fetch credential: network error');
    }
  }
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
 *       checks each hop's host against private and reserved address ranges and
 *       pins the connection to the addresses that check resolved, so neither a
 *       redirect nor a DNS change between check and connect can reach a
 *       private network. It also enforces the response-size limit, follows at
 *       most three additional redirect hops on either setting, and bounds the
 *       whole attempt (the wait for DNS, connect, redirects and body) by
 *       `FETCH_TIMEOUT_MS`. The connection is pinned to the addresses the name
 *       resolved to at validation time, tried in that order, so a `localhost`
 *       that resolves to both `::1` and `127.0.0.1` reaches whichever listens.
 *       Set `FETCH_ALLOW_PRIVATE_URLS=true` for local development to permit
 *       private or reserved destinations; the resolver's other checks remain
 *       active.
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
 *                 description: Storage URI where the credential is stored. Must be an HTTP(S) URL without embedded userinfo credentials.
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
 *         description: Validation error. A malformed field is named (missing or malformed uri, including one carrying userinfo credentials; invalid digestMultibase, hash, or decryptionKey format). Private or reserved destinations are refused unless `FETCH_ALLOW_PRIVATE_URLS=true`. A host that does not resolve is a 400 carrying the guard's message when that setting is off, and a 502 when it is on. A 400 also covers a redirect target the caller never submitted: the guard refuses that hop on its scheme or its destination; a destination refusal names the host, a scheme refusal names only the scheme.
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
 *                     `INVALID_RESPONSE`: the storage URI's response is not
 *                     valid JSON, or is valid JSON that is not an object (a
 *                     literal null, an array, or a primitive), before or after
 *                     decryption.
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
 *         description: Server error (e.g. system VC service not configured, or a fetch-setting conflict introduced after startup)
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
  // The schema owns the shape checks that used to live here as manual ifs
  // (http(s)-only uri, digest validity, hex-64 hash/key); it additionally
  // rejects userinfo-bearing uris, since this endpoint fetches the value
  // server-side and embedded credentials would be sent or logged. Legacy
  // `hash` stays accepted for verify URLs issued before the multibase
  // migration; they're out in the wild on QR codes and can't be reissued.
  logger.info('Parsing and validating request body');
  const body = await parseRequestBody(req, verifyCredentialRequestSchema);

  // The canonical WHATWG href, not the raw caller string, is what every
  // fetch branch and every URI-bearing log line below uses, so validation
  // and fetching cannot diverge on parser differentials (the same invariant
  // the issue route holds for its verification URLs).
  const credentialUri = new URL(body.uri).href;

  // ── Step 2: Fetch credential from storage URI ──────────────────────
  // The shared helper runs the guarded resolver in both modes. The local
  // development setting permits private destinations while retaining per-hop
  // validation, connection pinning, redirect handling and the byte cap.
  logger.info({ uri: credentialUri }, 'Fetching credential from storage');

  const maxSize = getMaxCredentialSize();
  let responseText: string;
  try {
    const document = await fetchCredentialDocument(credentialUri, { maxBytes: maxSize });
    responseText = new TextDecoder().decode(document.bytes);
  } catch (e: unknown) {
    if (!(e instanceof CredentialDocumentFetchError)) throw e;
    // Rejected inputs stay caller-facing validation errors. Preserve this
    // route's historical DNS status split while the helper reports DNS as a
    // retrieval failure in both modes.
    if (
      e.failure.kind === 'rejected' ||
      (e.failure.kind === 'failed' && e.failure.reason === 'dns' && !allowsPrivateUrls())
    ) {
      throw new ValidationError(e.failure.error.message);
    }
    return upstreamFailureResponse(e.failure, credentialUri, maxSize);
  }

  let fetchedData: unknown;
  try {
    fetchedData = JSON.parse(responseText);
  } catch {
    logger.warn({ uri: credentialUri }, 'Storage URI returned non-JSON response');
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
      logger.warn({ uri: credentialUri }, 'Encrypted envelope is structurally invalid');
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
      logger.warn({ uri: credentialUri, err: e }, 'Credential decryption failed');
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
      logger.warn({ uri: credentialUri }, 'Decrypted credential is not valid JSON');
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

  // JSON.parse accepts any JSON value, so both branches above can yield a
  // non-object (a literal null, an array, a primitive). None is a credential:
  // without this check a null reaches the type read below as a TypeError
  // turned 500, and the others reach it as a misleading
  // UNSUPPORTED_CREDENTIAL_TYPE. Both encrypted and unencrypted paths land
  // on the documented INVALID_RESPONSE instead.
  if (credential === null || typeof credential !== 'object' || Array.isArray(credential)) {
    logger.warn({ uri: credentialUri }, 'Credential content is not a JSON object');
    return NextResponse.json(
      { error: 'Credential content from the storage URI is not a JSON object', code: 'INVALID_RESPONSE' },
      { status: 422 },
    );
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
    logger.warn({ uri: credentialUri, credentialType: credential.type }, 'Unsupported credential type');
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
