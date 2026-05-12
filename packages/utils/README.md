# @uncefact/untp-utils

Shared utility primitives for UNTP packages and consumers.

## Installation

```bash
yarn add @uncefact/untp-utils
```

## MultibaseDigest

Encode, decode and verify multibase-encoded multihashes.

```ts
import { MultibaseDigest } from '@uncefact/untp-utils';

// Hash some data, wrap as a multihash, encode as a multibase string.
const digest = await MultibaseDigest.fromData(new TextEncoder().encode('hello'), {
  algorithm: 'sha2-256',
  base: 'base58btc',
});

digest.toString(); // "zQm..."   (base58btc)
digest.toString('base16'); // "f1220..." (re-encoded, no rehash)

// Parse a multibase string. Algorithm and encoding are read from the string.
const parsed = MultibaseDigest.fromString('zQm...');
parsed.algorithm; // "sha2-256"
parsed.base; // "base58btc"

// Verify against original data.
await parsed.verify(originalBytes); // true | false
```

Supported algorithms: `sha2-256`, `sha2-512`.

Supported multibase encodings: `base58btc`, `base64`.
