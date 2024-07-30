---
sidebar_position: 119
title: Conformity Credential
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

## Description

This section outlines three methods for creating and using [Conformity Credentials](https://uncefact.github.io/spec-untp/docs/specification/ConformityCredential) within the Mock App system. Each method offers different levels of automation and integration with external services.


### Manually Import Conformity Credential

This method involves manually creating and importing a Conformity Credential.

Steps:
1. Craft the Conformity Credential payload based on the [desired schema](https://uncefact.github.io/spec-untp/docs/specification/ConformityCredential#versions).
2. Sign the credential using the [Verifiable Credential service](/docs/mock-apps/dependent-services/verifiable-credential-service).
3. Store the credential in an external or [Local Storage service](/docs/mock-apps/dependent-services/storage-service).
4. [Format the URL](/docs/mock-apps/common/verify-link) for the conformity evidence reference.
5. Include the formatted URL in the Conformity Credential within the DPP data props in the [app config](/docs/mock-apps/configuration/) (conformityEvidence.reference).

#### Example config snippet:

```json
{
  "name": "Steel Mill 1",
  "type": "producer",
  "assets": {
    "logo": "https://example.com/Logo.jpg",
    "brandTitle": "Steel Mill 1"
  },
  "features": [
    {
      "name": "Issue DPP",
      "id": "produce_product",
      "components": [
        {
          "name": "JsonForm",
          "type": "EntryData",
          "props": {
            "schema": {
              "type": "object",
              "properties": {
                "conformityClaim": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "topic": { "type": "string" },
                      "standardOrRegulation": { "type": "string" },
                      "criteriaReference": { "type": "string" },
                      "claimedValues": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "name": { "type": "string" },
                            "value": {
                              "type": "object",
                              "properties": {
                                "value": { "type": "number" },
                                "unit": { "type": "string" }
                              }
                            },
                            "accuracy": { "type": "number" }
                          }
                        }
                      },
                      "benchmarkValue": {
                        "type": "object",
                        "properties": {
                          "name": { "type": "string" },
                          "value": {
                            "type": "object",
                            "properties": {
                              "value": { "type": "number" },
                              "unit": { "type": "string" }
                            }
                          }
                        }
                      },
                      "benchmarkReference": { "type": "string" },
                      "conformance": { "type": "boolean" },
                      "conformityEvidence": {
                        "type": "object",
                        "properties": {
                          "type": { "type": "string" },
                          "assuranceLevel": { "type": "string" },
                          "reference": { "type": "string" }
                        }
                      }
                    }
                  }
                }
              }
            },
            "data": {
              "conformityClaim": [
                {
                  "topic": "environment.emissions",
                  "standardOrRegulation": "https://example.org/standards/environment",
                  "criteriaReference": "https://example.org/standards/environment/criteria",
                  "claimedValues": [
                    { "name": "GHG Emissions", "value": { "value": 50, "unit": "KG_CO2E" }, "accuracy": 0.98 }
                  ],
                  "benchmarkValue": { "name": "Industry Benchmark", "value": { "value": 60, "unit": "KG_CO2E" } },
                  "benchmarkReference": "https://example.org/benchmarks/environment",
                  "conformance": true,
                  "conformityEvidence": {
                    "type": "w3c_vc",
                    "assuranceLevel": "3rdParty",
                    "reference": "http://localhost:3001/verify?q%3D%7Bpayload%3A%7Buri%3Ahttp%3A%2F%2Flocalhost%3A3001%2Fconformity-credentials%2Fsteel-mill-1-emissions.json%7D%7D"
                  }
                }
              ]
            }
          }
        }
      ],
      "services": []
    }
  ]
}
```


### Create Conformity Credential Within Mock App System

**To Be Implemented**

This method involves creating the conformity credential within the Mock App system by using a [feature](/docs/mock-apps/configuration/feature-config) that is composed of the [JsonForm component](/docs/mock-apps/components/json-form) and storing it in local storage or by using the Storage service.


### Request Conformity Credential from External Service
<!-- TODO: Confirm with Nam about this flow -->
This method uses the [ConformityCredential component](/docs/mock-apps/components/conformity-credential) to request a conformity credential from an external service, store it, and manage the received credentials.

Steps:
1. Configure the [ConformityCredential component](/docs/mock-apps/components/conformity-credential) in the [app config](/docs/mock-apps/configuration/) to specify the external service details and [storage options](/docs/mock-apps/common/storage).
2. Use the [ConformityCredential component](/docs/mock-apps/components/conformity-credential) to send a request to the external service for a Conformity Credential.
3. Receive the credential from the external service.
4. Store the received credential in the specified [storage service](/docs/mock-apps/dependent-services/storage-service).
5. Save a reference to the stored credential in local storage for future use (only accessible by the specified app).

All of the steps above are handled inside of the [ConformityCredential component](/docs/mock-apps/components/conformity-credential).

Example config snippet:

```json
{
  "name": "Steel Mill 1",
  "type": "producer",
  "features": [
    {
      "name": "Request Conformity Credential",
      "id": "request_conformity_credential",
      "components": [
        {
          "name": "ConformityCredential",
          "type": "Void",
          "props": {
            "credentialRequestConfigs": [
              {
                "url": "https://example.com/emissions-assessment",
                "params": {},
                "options": {
                  "headers": [],
                  "method": "POST"
                },
                "credentialName": "Emissions Assessment",
                "credentialPath": "/body/credential",
                "appOnly": "Steel Mill 1"
              }
            ],
            "storedCredentialsConfig": {
              "url": "http://localhost:3001/upload",
              "params": {
                "resultPath": "/url"
              },
              "options": {
                "method": "POST",
                "headers": {
                  "Content-Type": "application/json"
                }
              }
            }
          }
        }
      ],
      "services": []
    }
  ]
}
```

#### Using the Stored Credential in a DPP

To use the stored Conformity Credentials in the DPP issuance process, you have two options:

1. Using the [Conformity Credential Checkbox component](/docs/mock-apps/components/conformity-credential-checkbox)
2. Using the [Local Storage Loader component](/docs/mock-apps/components/local-storage-loader)


#### Option 1: Using the Conformity Credential Checkbox component
<!-- TODO: Confirm with Nam about the order of components -->

The [Conformity Credential Checkbox component](/docs/mock-apps/components/conformity-credential-checkbox) allows users to select one or more Conformity Credentials from a list of checkboxes. The component is added to the issue DPP [feature](/docs/mock-apps/configuration/feature-config). Here's how you can incorporate it into your DPP issuance process:

```json
{
  "name": "Steel Mill 1",
  "type": "producer",
  "features": [
    {
      "name": "Issue DPP",
      "id": "produce_product",
      "components": [
        {
          "name": "ConformityCredentialCheckbox",
          "type": "EntryData"
        },
        {
          "name": "JsonForm",
          "type": "EntryData",
          "props": {
            "schema": {
              /* Your DPP JSON schema */
            },
            "constructData": {
              "mappingFields": [
                {
                  "sourcePath": "/{app_name}/0/url",
                  "destinationPath": "/credentialSubject/conformityClaim/0/conformityEvidence/reference"
                }
              ]
            }
          }
        },
        {
          "name": "CustomButton",
          "type": "Submit",
          "props": {
            "label": "Submit",
            "description": "Click to submit the form"
          }
        }
      ],
      "services": [
        {
          /* Services to issue DPP */
        }
      ]
    }
  ]
}
```

#### Option 2: Using the Local Storage Loader component

<!-- TODO: Confirm with Nam about the mapping from local storage for CC -->
The [Local Storage Loader component](/docs/mock-apps/components/local-storage-loader) loads data from local storage and provides it to nested components. Here's how you can use it to load and incorporate Conformity Credentials:

```json
{
  "name": "Steel Mill 1",
  "type": "producer",
  "features": [
    {
      "name": "Issue DPP",
      "id": "produce_product",
      "components": [
        {
          "name": "LocalStorageLoader",
          "type": "EntryData",
          "props": {
            "storageKey": "Farm_conformity_credentials",
            "nestedComponents": [
              {
                "name": "JsonForm",
                "type": "EntryData",
                "props": {
                  "schema": {
                    /* Your DPP JSON schema */
                  },
                  "constructData": {
                    "mappingFields": [
                      {
                        "sourcePath": "/{app_name}/0/url",
                        "destinationPath": "/credentialSubject/conformityClaim/0/conformityEvidence/reference"
                      }
                    ]
                  }
                }
              },
              {
                "name": "CustomButton",
                "type": "Submit",
                "props": {
                  "label": "Submit",
                  "description": "Click to submit the form"
                }
              }
            ]
          }
        }
      ],
      "services": [
        {
          /* Services to issue DPP */
        }
      ]
    }
  ]
}
```