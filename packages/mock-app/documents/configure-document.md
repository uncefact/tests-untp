# Instruction

The mock app is using some services such as [VCKit](https://github.com/uncefact/project-vckit), [digital link resolver](https://github.com/gs1/GS1_DigitalLink_Resolver_CE), and [storage service](../../storage-server/README.md) that need to be ran in the background. These services are recommended to use, in case you want to replace them with your own services, you can do so by modifying the configuration file.
The detail of running the services can be found in the README of each service.

# Configuration file

The configuration file of mock app has the following structure:

```json
{
  "name": "name of the system",
  "style": {}, // style configuration for system
  "generalFeatures": [], // list of general features such as "request conformity credentials"
  "apps": [], // list of apps in the system that can demonstrate the working of your mock system
  "identifyProvider": {}, // the configuration of the identify provider to be used to identify your products such as "GS1"
  "defaultVerificationServiceLink": {} // the default verification service link to be used to verify your products when the verification service link is not provided
}
```

## General features

The general feature configuration has the following structure:

```json
{
  "name": "name of the feature",
  "style": {}, // style configuration for the feature
  "features": [] // list of features in the general feature
}
```

The general features are the features that support the apps to dynamic configure the them based on the result of the general features. Like the request conformity credentials feature, the apps can receive the conformity credentials after the request is made.

### Feature

The feature configuration has the following structure:

```json
{
  "name": "name of the feature",
  "id": "id_of_feature", // the id is used to identify the feature
  "components": [
    {
      "name": "ConformityCredential", // the name of the component must be from the components package that is use to render the component. The components package is in the `packages/components/src/components` folder
      "type": "type of the component", // the type of the component
      "props": {} // the props of the component is depend on the component, you can find the props of the component in the component file or can find in the example of configuration file.
    }
  ],
  "services": [
    {
      "name": "constructorEntryData", // the name of the service must be from the services package that is use to call the service. The services package is in the `packages/services` folder. The service will take the state of the components for the first parameter and the rest of the parameters are the parameters of the service.
      "parameters": [] // the parameters of the service is depend on the service, you can find the parameters of the service in the service file or can find in the example of configuration file.
    }
  ]
}
```

So you can see the `services` is an array of services that will be called sequentially. The first service will take the state of the components for the first parameter and the rest of the parameters are the parameters of the service, then the result of the first service will be passed to the second service and the rest of the parameters are the parameters of the second service, and so on.

## App

The app configuration has the following structure:

```json
{
  "name": "name of the app",
  "style": {}, // style configuration for app
  "features": [] // list of features in the app
}
```

The app represents the application in the supply chain system that the user can interact to issue the credentials and interact with another credential from another app.

The feature configuration in the app is the same as the general feature configuration.

In example, we choose the `JsonForm` component for almost features in the app, because it is flexible to configure the form based on the json schema, which can be defined before and now we can use it to render the form.

## Identify provider

The identify provider configuration has the following structure:

```json
{
  "type": "gs1",
  "url": "https://verified-by-gs1.agtrace.showthething.com"
}
```

The identify provider is used to identify the products is used in the system. Currently, we only support the GS1 identify provider. You need to replace the `url` with your own identify provider url.

## Default verification service link

The default verification service link is the VCKit verification service that is used to verify the credential when the verification service is not provided. You can replace the `url` with your own verification service link.

The default verification service link configuration has the following structure:

```json
{
  "title": "Default Verification Service",
  "context": "Default Verification Service",
  "type": "application/json",
  "href": "https://verify.agtrace.showthething.com/credentials/verify",
  "hreflang": ["en"]
}
```

# How to configure the mock app to demonstrate the working of your system

First, you can copy the example configuration `packages/mock-app/src/constants/app-config.example.ts` to `packages/mock-app/src/constants/app-config.ts` and modify the configuration file.

Then, you need to figure out your apps system, for example, in the example we used the `red meat` domain that has 3 apps: farm, feedlot, and processor. Now you need to list down the main feature of the apps that impact the supply chain system, the features is represented by the [traceability events](https://uncefact.github.io/spec-untp/docs/specification/TraceabilityEvents) such as `object event`, `aggregation event`, `transformation event`, and `transaction event`.
For example, the `farm` app has the `object event` in the breeding process, the `feedlot` app has the `transaction event` in the selling process, and the `processor` app has the `transformation event` in the processing process.
Based on the example, you can define the features of the apps in the configuration file like:

```json
{
  "name": "Red meat",
  "styles": {
    "primaryColor": "rgb(41, 171, 48)",
    "secondaryColor": "white",
    "tertiaryColor": "black"
  },
  "apps": [
    {
      "name": "Farm",
      "features": [
        {
          "name": "Breed cows",
          "id": "produce_product",
          "components": [
            {
              "name": "JsonForm",
              "type": "EntryData",
              "props": {
                // Json schema for the form
              }
            },
            {
              "name": "CustomButton",
              "type": "Submit",
              "props": {}
            }
          ],
          "services": [
            {
              "name": "processObjectEvent",
              "parameters": [
                {
                  "vckit": {
                    "vckitAPIUrl": "http://localhost:3332",
                    "issuer": "did:web:example.com"
                  },
                  "dpp": {
                    "context": ["https://dpp-json-ld.s3.ap-southeast-2.amazonaws.com/dppld.json"],
                    "renderTemplate": [
                      { "template": "<p>Render dpp template</p>", "@type": "WebRenderingTemplate2022" }
                    ],
                    "type": ["DigitalProductPassport"],
                    "dlrLinkTitle": "Livestock Passport",
                    "dlrIdentificationKeyType": "nlisid",
                    "dlrVerificationPage": "http://localhost:3001/verify"
                  },

                  "dlr": {
                    "dlrAPIUrl": "http://localhost",
                    "dlrAPIKey": "dlrAPIKey"
                  },
                  "storage": {
                    "url": "https://storage.example.com",
                    "params": {},
                    "options": {
                      "headers": [],
                      "method": "POST"
                    }
                  },
                  "identifierKeyPaths": ["herd", "NLIS"]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "name": "Feedlot",
      "features": [
        {
          "name": "Sell cows",
          "id": "produce_product",
          "components": [
            {
              "name": "JsonForm",
              "type": "EntryData",
              "props": {
                // Json schema for the form
              }
            },
            {
              "name": "CustomButton",
              "type": "Submit",
              "props": {}
            }
          ],
          "services": [
            {
              "name": "processTransactionEvent",
              "parameters": [
                {
                  "vckit": {
                    "vckitAPIUrl": "https://vckit.example.com",
                    "issuer": "did:web:vckit.example.com"
                  },
                  "epcisTransactionEvent": {
                    "context": ["https://dpp.example.com/transaction-event-ld.json"],
                    "renderTemplate": [
                      { "template": "<p>Render dpp template</p>", "@type": "WebRenderingTemplate2022" }
                    ],
                    "type": ["TransactionEventCredential"],
                    "dlrLinkTitle": "Transaction Event",
                    "dlrIdentificationKeyType": "nlisid",
                    "dlrVerificationPage": "http://dlr.example.com/verify"
                  },
                  "dlr": {
                    "dlrAPIUrl": "http://dlr.example.com",
                    "dlrAPIKey": "dlrAPIKey"
                  },
                  "storage": {
                    "url": "https://storage.example.com",
                    "params": {},
                    "options": {
                      "headers": [],
                      "method": "POST"
                    }
                  },
                  "identifierKeyPaths": ["transaction", "identifier"]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "name": "Processor",
      "features": [
        {
          "name": "Process cow",
          "id": "produce_product",
          "components": [
            {
              "name": "JsonForm",
              "type": "EntryData",
              "props": {
                // Json schema for the form
              }
            },
            {
              "name": "CustomButton",
              "type": "Submit",
              "props": {
                "style": { "textAlign": "center", "paddingTop": "20px" }
              }
            }
          ],
          "services": [
            {
              "name": "processTransformationEvent",
              "parameters": [
                {
                  "epcisTransformationEvent": {
                    "context": ["https://dpp.example.com/transformation-event-ld.json"],
                    "renderTemplate": [
                      { "template": "<p>Render epcis template</p>", "@type": "WebRenderingTemplate2022" }
                    ],
                    "type": ["TransformationEventCredential"],
                    "dlrIdentificationKeyType": "gtin",
                    "dlrLinkTitle": "EPCIS transformation event VC",
                    "dlrVerificationPage": "https://web.example.com/verify",
                    "dlrQualifierPath": ""
                  },
                  "dpp": {
                    "context": ["https://dpp.example.com/dppld.json"],
                    "renderTemplate": [
                      { "template": "<p>Render dpp template</p>", "@type": "WebRenderingTemplate2022" }
                    ],
                    "type": ["DigitalProductPassport"],
                    "dlrIdentificationKeyType": "gtin",
                    "dlrLinkTitle": "Digital Product Passport",
                    "dlrVerificationPage": "https://web.example.com/verify",
                    "dlrQualifierPath": ""
                  },
                  "vckit": {
                    "vckitAPIUrl": "https://vckit.example.com",
                    "issuer": "did:web:vckit.example.com"
                  },
                  "dlr": {
                    "dlrAPIUrl": "http://localhost",
                    "dlrAPIKey": "dlrAPIKey"
                  },
                  "storage": {
                    "url": "https://storage.example.com",
                    "params": {},
                    "options": {
                      "headers": [],
                      "method": "POST"
                    }
                  },
                  "productTransformation": {
                    "inputItems": [{ "quantity": 1, "uom": "head", "productClass": "cattle" }],
                    "outputItems": [
                      {
                        "productID": "9359502000041",
                        "productClass": "Beef Silverside",
                        "quantity": 500,
                        "weight": 500,
                        "uom": "kilogram",
                        "image": "https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000041/AgTace-Meats-Silverside.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D",
                        "description": "Deforestation-free Beef Silverside"
                      },
                      {
                        "productID": "9359502000034",
                        "productClass": "Beef Scotch Fillet",
                        "quantity": 300,
                        "weight": 300,
                        "uom": "kilogram",
                        "image": "https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000034/Beef-Scotch-Fillet-Steak-300g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D",
                        "description": "Deforestation-free Beef Scotch Fillet"
                      },
                      {
                        "productID": "9359502000010",
                        "productClass": "Beef Rump Steak",
                        "quantity": 250,
                        "weight": 250,
                        "uom": "kilogram",
                        "image": "https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000010/Beef-Rump-Steak-250g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D",
                        "description": "Deforestation-free Beef Rump Steak"
                      }
                    ]
                  },
                  "identifierKeyPaths": ["NLIS"]
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "identifyProvider": {
    "type": "gs1",
    "url": "https://identify-provider.example.com"
  },
  "defaultVerificationServiceLink": {
    "title": "Default Verification Service",
    "context": "Default Verification Service",
    "type": "application/json",
    "href": "https://verify.example.com/credentials/verify",
    "hreflang": ["en"]
  }
}
```

## The traceability events

The traceability events are built as services in the `packages/services/src/epcisEvents` folder. The services integrate with the VCKit, digital link resolver, and storage service are configured in the configuration of the features in the app. You need to start the services before running the mock app.

## The conformity credentials request

The conformity credentials request are built as a component with the name `ConformityCredential` in the `packages/components/src/components` folder. To configure the conformity credentials request, you need to define the feature in the general features configuration.

```json
{
  // The general features configuration
  "generalFeatures": [
    {
      "name": "General features",
      "features": [
        {
          "name": "Conformity Credential",
          "id": "conformity_credential",
          "components": [
            {
              "name": "ConformityCredential",
              "type": "",
              "props": {
                "credentialRequestConfigs": [
                  {
                    "url": "http://conf-cred.example.com",
                    "params": {},
                    "options": {
                      "headers": [],
                      "method": "POST"
                    },
                    "credentialName": "Deforestation Free Assessment",
                    "credentialPath": "/foo/bar", // The path to get the credential from the response of the request
                    "appOnly": "Farm" // The app that can receive the conformity credential when issue the credential
                  }
                ],
                "storage": {
                  "url": "https://storage.example.com",
                  "params": {},
                  "options": {
                    "headers": [],
                    "method": "POST"
                  }
                }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Now you can build the configuration file to demonstrate the working of your system.
