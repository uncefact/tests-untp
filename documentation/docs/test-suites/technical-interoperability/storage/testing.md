---
sidebar_position: 9
title: Testing Storage
---

import Disclaimer from '../../../\_disclaimer.mdx';

<Disclaimer />

The Storage component is a critical part of the UNTP ecosystem, responsible for [securely storing and retrieving credentials and related data](https://uncefact.github.io/spec-untp/docs/specification/DecentralisedAccessControl). This test suite verifies the functionality, security, and accessibility of your storage implementation.

## Testing Instructions

To test your Storage implementation, follow these steps:

1. **Update the Configuration**:

   - Navigate to the config file: `packages/vc-test-suite/config.ts`
   - Update the `Storage` section with your implementation details. The file should look similar to this:

     ```typescript
     export default {
       implementationName: 'UNTP ACME',
       testSuites: {
         Storage: {
           url: 'http://localhost:3334/v1/documents',
           encryptionUrl: 'http://localhost:3334/v1/credentials',
           headers: {},
           additionalParams: {},
           additionalPayload: { bucket: 'verifiable-credentials' },
         },
       },
     };
     ```

   Adjust the `url`, `encryptionUrl`, `headers`, `additionalParams`, and `additionalPayload` as necessary for your implementation.

2. **Run the Test**:

   - Navigate to `packages/vc-test-suite`
   - In your terminal, run the command: `yarn test`

3. **View Test Results**:
   - Navigate to `packages/vc-test-suite/reports/index.html`
   - Open this file in a web browser
   - Look for the "Storage Service" section to view your test results

- `url`: This is the full URL for the unencrypted storage service endpoint of your storage service.

- `encryptionUrl`: This is the full URL for the encryption service endpoint of your storage service.

- `headers`: An object containing any additional HTTP headers required for the request to the storage service. You may need to add headers depending on your implementation.

- `method`: The HTTP method used to request the verifiable credential from the storage service. In this case, it's set to 'POST'.

- `additionalParams`: An object containing any additional parameters required for the request to the storage service.

- `additionalPayload`: An object containing any additional payload required for the request to the storage service.
