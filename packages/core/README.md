# Core

React components for the core of the application, rendering the page by wrap up the component. The core package has an app-config file that contains the configuration of UI and Services that will render and call the services function when the user trigger an event.

# Example

#app-config.json

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
      "type": "producer",
      "assets": {
        "logo": "https://example.com/logo.png",
        "brandTitle": "Wagu Wonder",
        "passportVC": "",
        "transactionEventVC": ""
      },
      "styles": {
        "primaryColor": "rgb(41, 171, 48)",
        "secondaryColor": "white",
        "tertiaryColor": "black"
      },
      "features": [
        {
          "name": "Digital Livestock",
          "id": "produce_product",
          "components": [
            {
              "name": "JsonForm",
              "type": "EntryData",
              "props": {
                "formTitle": "Digital Livestock Passport",
                "schema": {
                  "type": "object",
                  "properties": {
                    "herd": {
                      "type": "object",
                      "title": "Herd Information",
                      "properties": {
                        "NLIS": {
                          "title": "NLIS",
                          "type": "string",
                          "uniqueItems": true,
                          "enum": ["NH020188LEJ00005", "NH020188LEJ00008", "NH020188LEJ00012"]
                        },
                        "traceabilityInfo": {
                          "type": "array",
                          "title": "Traceability Information",
                          "items": {
                            "type": "object",
                            "properties": {
                              "EventReference": {
                                "type": "string",
                                "title": "Event Reference"
                              },
                              "EventType": {
                                "type": "string",
                                "title": "Event Type"
                              }
                            }
                          }
                        },
                    },
                    "sustainabilityScore": {
                      "type": "integer",
                      "title": "Sustainability Score"
                    },
                    "trustScore": {
                      "type": "integer",
                      "title": "Trust Score"
                    }
                  }
                },
                "initialData": {},
                "className": "json-form",
                "style": { "margin": "auto", "paddingTop": "40px", "width": "80%" }
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
              "name": "processObjectEvent",
              "parameters": [
                {
                  "vckit": {
                    "vckitAPIUrl": "https://vckit.example.com",
                    "issuer": "did:web:issuer.example.com",
                  },
                  "dpp": {
                    "context": ["https://www.w3.org/2018/credentials/v1"],
                    "renderTemplate": [
                      { "template": "<p>Render dpp template</p>", "@type": "WebRenderingTemplate2022" }
                    ],
                    "type": ["DigitalProductPassport"],
                    "dlrLinkTitle": "Livestock Passport",
                    "dlrIdentificationKeyType": "nlisid",
                    "dlrVerificationPage": "http://example.com/verify"
                  },
                  "dlr": {
                    "dlrAPIUrl": "http://dlr.example.com",
                    "dlrAPIKey": "5555555555555"
                  },
                  "storage": {
                    "storageAPIUrl": "https://storage.example.com",
                    "bucket": "example-bucket"
                  },
                  "identifierKeyPaths": ["herd", "NLIS"]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

# How app-config.json works:

`name`: The name of the app that will be displayed on the header of the page.\
`styles`: The color of the app that will be used to style the app.\
`apps`: The list of pages that will be rendered on the page.\

- `name`: The name of the page that will be displayed on the header of the page.\
- `type`: The type of the page that will be used to style the page.
- `assets`: The assets of the page that will be used to display the logo and the title of the page.
- `styles`: The color of the page that will be used to style the page.
- `features`: The list of features that will be rendered on the page.

  - `name`: The name of the feature that will be displayed on the header of the page.\
  - `id`: The id of the feature that will be used to style the feature.
  - `components`: The list of components that will be rendered on the page.

    - `name`: The name of the component that will be displayed on the page, this name should follow the name in component in components package.\
    - `type`: The type of the component that will be used to style the component.\
    - `props`: The props of the component that will be used to display the component.

- `services`: The list of services that will be called when the user trigger an event.

  - `name`: The name of the service that will be called when the user trigger an event, this name should follow the name in services function in services package..\
  - `parameters`: The parameters of the service that will be used to call the service.

## Prerequisites

- Should have components package and services package installed.
- For example:

```sh
yarn workspace @mock-app/core add @mock-app/components@1.0.0
```

## Install package before start

```sh
yarn install
```

## Start the project

```sh
yarn start
```
