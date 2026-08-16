import { z } from 'zod';
import { AccessRole } from '@uncefact/untp-ri-services';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { bcp47TagSchema, booleanQuerySchema, idSchema, nonBlankString, paginationQuerySchema } from './shared';

const HEX_64 = /^[a-f0-9]{64}$/i;

/**
 * Storage service options for POST /credentials. Previously unvalidated at
 * the boundary, so a mistyped value (e.g. `encrypt: "false"`, which the
 * issue path's `encrypt !== false` check treats as encrypt-on) rode through
 * to the service layer; both fields are now shape-checked here.
 */
const storageOptionsSchema = z.object({
  serviceInstanceId: idSchema.optional().describe('Storage service instance ID'),
  encrypt: z.boolean().optional().describe('Whether to encrypt the stored credential'),
});

/**
 * IDR publishing options for POST /credentials.
 *
 * The verification URLs are format-checked here (well-formed URL). The
 * handler additionally applies assertHttpUrl and uses its canonical `.href`
 * for the SSRF check and for publishing (ADR-037 layering): the schema check
 * is a fast well-formedness gate, never a replacement for that
 * canonicalisation, which exists to close parser-differential SSRF holes.
 *
 * `linkType` is tightened to a non-blank string but stays free-form: the GS1
 * link-relation vocabulary is open, so there is no enum to check against.
 */
export const publishingOptionsSchema = z.object({
  publish: z.boolean().optional().describe('Whether to publish the credential to the Identity Resolver'),
  linkType: nonBlankString
    .optional()
    .describe("UNTP link relation type (defaults to the IDR service's configured default link type)"),
  linkTitle: z.string().optional().describe('Title for the published link (defaults to data model name)'),
  identifierSchemeId: idSchema
    .optional()
    .describe(
      "Identifier scheme to publish under, required only when the credential's identifier value exists under more than one scheme",
    ),
  qualifierPath: z
    .string()
    .optional()
    .describe('Qualifier path for sub-identifiers (e.g. /10/LOT123/21/SER456). Defaults to /'),
  machineVerificationUrl: z.string().url().optional().describe('Machine verification URL (a well-formed HTTP(S) URL)'),
  humanVerificationUrl: z
    .string()
    .url()
    .optional()
    .describe(
      'Human verification URL (a well-formed HTTP(S) URL). When publishing without one, defaults to this RI verify page, ${RI_APP_URL}/verify',
    ),
  hreflang: z
    .array(bcp47TagSchema)
    .optional()
    .describe(
      'Well-formed BCP 47 language tags the credential resource is available in (attached to the credential link only)',
    ),
  additionalRels: z
    .array(z.string().min(1))
    .optional()
    .describe('Additional link relation types qualifying the credential link beyond its primary rel'),
  public: z
    .boolean()
    .optional()
    .describe(
      'Whether the credential target URL is safe to publish in a public directory. Distinct from access control on the resource content',
    ),
  accessRole: z
    .array(z.nativeEnum(AccessRole))
    .optional()
    .describe(
      'UNTP access roles governing who the published links are surfaced to, attached to the credential and human verification links (e.g. untp:accessRole#Regulator)',
    ),
});

/**
 * Request body for POST /credentials. `credentialPayload` is deliberately an
 * open object: its real validation is the downstream JSON Schema and JSON-LD
 * pass against the resolved data model, which owns payload shape; the
 * boundary only asserts "an object was sent". After that pass succeeds the
 * handler asserts the value to CredentialPayload in one place.
 */
export const credentialIssueRequestSchema = z.object({
  credentialPayload: z.record(z.unknown()).describe('The full credential payload to sign'),
  credentialType: nonBlankString.describe(
    'Type of credential to issue (e.g. DigitalProductPassport, DigitalLivestockPassport)',
  ),
  version: nonBlankString.describe('Data model version'),
  storageOptions: storageOptionsSchema.optional().describe('Storage service options'),
  publishingOptions: publishingOptionsSchema.optional().describe('IDR publishing options'),
});

/**
 * Query parameters for GET /credentials. `credentialType` stays a plain
 * optional string (empty and whitespace values remain accepted, flowing
 * through as the exact-match filter they always were; an unknown type is a
 * 200 empty page, not an error). Merged ahead of pagination (ADR-037).
 */
export const listCredentialsQuerySchema = z
  .object({
    credentialType: z.string().optional(),
    isPublished: booleanQuerySchema,
  })
  .merge(paginationQuerySchema);

/**
 * Request body for POST /credentials/verify, porting the route's previous
 * hand-rolled checks with the same semantics. Refines that wrap throwing
 * parsers (URL, MultibaseDigest) catch and return false so malformed input
 * is a named 400, never a 500.
 *
 * `uri` rejects userinfo-bearing URLs (`https://user:pass@host/...`): the
 * endpoint fetches the URI server-side, so embedded credentials would either
 * be sent as basic auth or logged, and no legitimate storage link carries
 * them. The handler fetches and logs the canonical parsed `.href`, not the
 * raw string, mirroring the publish path's canonicalisation invariant.
 */
export const verifyCredentialRequestSchema = z.object({
  uri: z
    .string({ required_error: 'is required' })
    .min(1, 'is required')
    .superRefine((value, ctx) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a valid URL' });
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a valid HTTP(S) URL' });
        return;
      }
      if (parsed.username !== '' || parsed.password !== '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must not contain userinfo credentials' });
      }
    })
    .describe('Storage URI where the credential is stored (HTTP(S), no embedded credentials)'),
  digestMultibase: z
    .string()
    .refine(
      (value) => {
        try {
          MultibaseDigest.fromString(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'must be a valid multibase-encoded multihash' },
    )
    .optional()
    .describe('Expected multibase-encoded multihash digest of the credential content'),
  hash: z
    .string()
    .regex(HEX_64, 'must be a 64-character hex string (SHA-256)')
    .optional()
    .describe('Legacy SHA-256 hex digest, accepted for verify URLs issued before the multibase migration'),
  decryptionKey: z
    .string()
    .regex(HEX_64, 'must be a 64-character hex string')
    .optional()
    .describe('AES-256-GCM decryption key (64-character hex string)'),
});
