import { z } from 'zod';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';

const HEX_64 = /^[a-f0-9]{64}$/i;

/** Storage options accepted by POST /credentials. */
export const storageOptionsSchema = z.object({
  serviceInstanceId: z.string().min(1).optional().describe('Storage service instance ID'),
  encrypt: z.boolean().optional().describe('Whether to encrypt the stored credential'),
});

/** IDR publishing options accepted by POST /credentials. */
export const publishingOptionsSchema = z.object({
  publish: z.boolean().optional().describe('Whether to publish the credential to the Identity Resolver'),
  linkType: z.string().optional().describe('UNTP link relation type (defaults to gs1:sustainabilityInfo)'),
  linkTitle: z.string().optional().describe('Title for the published link (defaults to data model name)'),
  qualifierPath: z
    .string()
    .optional()
    .describe('Qualifier path for sub-identifiers (e.g. /10/LOT123/21/SER456). Defaults to /'),
  machineVerificationUrl: z.string().optional().describe('Machine verification URL'),
  humanVerificationUrl: z.string().optional().describe('Human verification URL'),
  hreflang: z
    .array(z.string().min(1))
    .optional()
    .describe('BCP 47 language tags the credential resource is available in (attached to the credential link only)'),
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
});

/** Request body for POST /credentials. */
export const issueCredentialRequestSchema = z.object({
  credentialPayload: z.record(z.unknown()),
  credentialType: z.string().min(1),
  version: z.string().min(1),
  storageOptions: storageOptionsSchema.optional(),
  publishingOptions: publishingOptionsSchema.optional(),
});

/** Request body for POST /credentials/verify. */
export const verifyCredentialRequestSchema = z.object({
  uri: z.string().min(1),
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
    .optional(),
  hash: z.string().regex(HEX_64, 'must be a 64-character hex string (SHA-256)').optional(),
  decryptionKey: z.string().regex(HEX_64, 'must be a 64-character hex string').optional(),
});
