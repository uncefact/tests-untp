---
sidebar_position: 6
title: Storage Service
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

The Storage Service plays a vital role in the United Nations Transparency Protocol (UNTP) ecosystem by providing a [secure and efficient](https://uncefact.github.io/spec-untp/docs/specification/DecentralisedAccessControl) way to store credentials and documents.

It offers the following capabilities:
- Storage of credentials created by the Verifiable Credential Service.
- Storage of documents, such as invoices, used to mimic value chain activities.
- Support for storing credentials in plain text or encrypting them while returning the encryption key and hash.

For the Mock Apps, we recommend and will be using the UN's reference implementation located within the [Identity Resolver Service repository](https://github.com/uncefact/project-identity-resolver).

### Storage Service Documentation

Please go through the Storage Service documentation available [here](https://github.com/uncefact/project-identity-resolver#project-identity-resolver) to understand how to set up and use the Storage Service.

### Examples
<!-- TODO: Remove once storage service is documented -->
#### Store the credential

```bash
curl -X POST \
  http://localhost:3001/upload \
  -H 'Content-Type: application/json' \
  -d '{
    "filename": "conformity-credentials/steel-mill-1-emissions.json",
    "data": {
      "Your credential data here"
    }
  }'
```
You would replace `"Your credential data here"` with the actual credential data you want to store (just the verifiable credential).

#### Fetch the credential

```bash
curl -X GET \
  http://localhost:3001/conformity-credentials/steel-mill-1-emissions.json \
  -H 'Accept: application/json'
```


### Requirements

To use the Storage Service with the mock apps, you will need:

1. The Storage Service API running.
2. The address of the Storage Service (e.g.http://localhost:3001/upload)
3. The API key of the Storage Service API (if applicable)

Make sure you have the Storage Service API set up and running, and note its address and API key (if applicable) before proceeding with the mock app configuration.

In the next section, we will explore the Identity Resolver Service and its role in the UNTP ecosystem.