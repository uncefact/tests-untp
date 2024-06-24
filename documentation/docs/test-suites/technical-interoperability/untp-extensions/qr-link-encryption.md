---
sidebar_position: 6
title: QR Link / Encryption
---

import Disclaimer from './../../../\_disclaimer.mdx';

<Disclaimer />

The QR Link / Encryption feature is a crucial component of the UNTP ecosystem, providing a standardised way to access, verify, and render credentials.

For detailed information about the Verify Link structure and usage, please refer to the [Verify Link documentation](/docs/mock-apps/common/verify-link).

## Testing Instructions

To test your QR Link / Encryption implementation, follow these steps:

1. **Obtain a Verify Link**: Obtain a verify link produced by your implementation that you would like to test.

2. **Update the Configuration**:

   - Navigate to the config file: `packages/vc-test-suite/config.ts`
   - Update the `QrLinkEncrypted` section with your verify link (see [payload structure](/docs/test-suites/technical-interoperability/untp-extensions/qr-link-encryption#payload-structure)). The file should look similar to this:

     ```typescript
     export default {
       implementationName: 'UNTP ACME',
       testSuites: {
         QrLinkEncrypted: {
           url: 'https://example.com/credential-verifier?q=%7B%22payload%22%3A%7B%22uri%22%3A%22https%3A%2F%2Fapi.vckit.showthething.com%2Fencrypted-storage%2Fencrypted-data%2F0a6031a9-2740-49cd-b12b-1ed02820f01d%22%2C%22key%22%3A%22d0ad322ec820a0a420262a6b7dbdafb16eb1d35af459182022bc531d18643546%22%2C%20%22hash%22%3A%20%22QmX8fk9hygXQDbt4KsGEMiUXbt7HDRnb772HNcKtZcL2Zr%22%7D%7D',
           headers: {},
           method: 'GET',
         },
       },
     };
     ```

   Replace the `url` value with your verify link.

3. **Run the Test**:

   - Navigate to `packages/vc-test-suite`
   - In your terminal, run the command: `yarn test`

4. **View Test Results**:
   - Navigate to `packages/vc-test-suite/reports/index.html`
   - Open this file in a web browser
   - Look for the "QR Link Verification" section to view your test results

These tests will validate that your QR Link / Encryption implementation adheres to the UNTP protocol.

## Payload Structure

The QR Link payload is a crucial part of the verification process. Let's break down the structure of the payload:

```javascript
QrLinkEncrypted: {
  url: 'https://example.com/credential-verifier?q=%7B%22payload%22%3A%7B%22uri%22%3A%22https%3A%2F%2Fapi.vckit.showthething.com%2Fencrypted-storage%2Fencrypted-data%2F0a6031a9-2740-49cd-b12b-1ed02820f01d%22%2C%22key%22%3A%22d0ad322ec820a0a420262a6b7dbdafb16eb1d35af459182022bc531d18643546%22%2C%20%22hash%22%3A%20%22QmX8fk9hygXQDbt4KsGEMiUXbt7HDRnb772HNcKtZcL2Zr%22%7D%7D',
  headers: {},
  method: 'GET',
},
```

- `url`: This is the full URL for the credential verifier, including the encoded payload.

- `headers`: An object containing any additional HTTP headers required for the request to the storage service. In this example, it's empty, but you may need to add headers depending on your implementation.

- `method`: The HTTP method used to request the verifiable credential from the storage service. In this case, it's set to 'GET'.

The `uri` within the payload points to the storage service that will return the verifiable credential. The `headers` and `method` are used in the request to this storage service.
