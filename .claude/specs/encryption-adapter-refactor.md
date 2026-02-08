# Encryption / Crypto Service Refactor

## Context

The storage service's `/private` endpoint stores an encrypted envelope with a `contentType` field:

```json
{
  "cipherText": "...",
  "iv": "...",
  "tag": "...",
  "type": "aes-256-gcm",
  "contentType": "image/png"
}
```

Decrypted content may be either raw JSON or a base64-encoded binary file. The `contentType` field tells the consumer which.

## Scope

All changes are in `packages/services/src/utils/cryptoService.ts` and its consumers.

## Changes

### 1. Update `DecryptionParams` to include `contentType`

```typescript
export interface DecryptionParams {
  cipherText: string;
  key: string;
  iv: string;
  tag: string;
  type: EncryptionAlgorithm;
  contentType?: string; // New -- optional for backwards compatibility
}
```

### 2. New `DecryptionResult` interface

```typescript
export interface DecryptionResult {
  data: string | Buffer;
  contentType: string;
}
```

### 3. Update `decryptCredential` to return `DecryptionResult`

Current signature:
```typescript
decryptCredential(params: DecryptionParams): string
```

New signature:
```typescript
decryptCredential(params: DecryptionParams): DecryptionResult
```

Post-decryption handling logic:
- Read `contentType` from params (default to `"application/json"` if missing)
- If `contentType` is `"application/json"`: return `{ data: decryptedString, contentType }`
- Otherwise: return `{ data: Buffer.from(decryptedString, 'base64'), contentType }`

### 4. Update `computeHash` to accept `Buffer`

Current:
```typescript
computeHash(credential: Record<string, any>): string
```

New:
```typescript
computeHash(input: Record<string, any> | Buffer): string
```

Logic:
- If input is a `Buffer`: hash the buffer directly
- If input is an object: `JSON.stringify` then hash (existing behaviour)

### 5. Backwards compatibility

- `contentType` is optional -- envelopes created before this change won't have it
- Missing `contentType` -> treat as `"application/json"` (all previously encrypted data was JSON)
- No changes needed to the encryption/decryption algorithms themselves

## Consumers to update

- `packages/mock-app/src/app/(public)/verify/page.tsx` -- handles `DecryptionResult` instead of `string`
- `packages/vc-test-suite/tests/QrLinkVerification/qrlink-verification.test.ts` -- handles `DecryptionResult`
- `packages/services/src/__tests__/cryptoService.test.ts` -- test new return type and binary handling
