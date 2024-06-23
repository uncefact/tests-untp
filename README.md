# tests-untp

UNTP mock implementation is a mock app that presents how the decentralized app works. There are three main packages in this repository: components, core, and services. The components package contains the UI components, the core package plays the role of the render page by using the components package and interacting with the services package and the services package contains the business logic.

## Prerequisites

- [Node.js](https://nodejs.org/en/) version 20.12.2
- [yarn](https://yarnpkg.com/) version 1.22.22

### Install dependencies

```bash
yarn install
```

### Copy the .app-config.example file to .env for the demo explorer

```bash
cp packages/mock-app/src/constants/app-config.example.json packages/mock-app/src/constants/app-config.json
```

### Update the app-config.json file with the correct values, for example:

```json
{
  "services": [
    {
      "name": "processDPP", // Service name
      "parameters": [
        {
          "vckit": {
            "vckitAPIUrl": "https://vckit.example.com", // URL of the VC API
            "issuer": "did:web:vckit.example.com" // Issuer DID
          },
          "dpp": {
            "context": ["https://dpp.example.com/dppld.json"], // DPP context, please refer to the DPP documentation, if it is not provided, the error message will be displayed
            "renderTemplate": [{ "template": "<p>Render dpp template</p>", "@type": "WebRenderingTemplate2022" }],
            "type": ["DigitalProductPassport"],
            "dlrLinkTitle": "Livestock Passport",
            "dlrIdentificationKeyType": "gtin",
            "dlrVerificationPage": "http://dlr.example.com/verify" // DLR verification page
          },

          "dlr": {
            "dlrAPIUrl": "http://dlr.example.com", // DLR API URL
            "dlrAPIKey": "5555555555555"
          },
          "storage": {
            "url": "https://storage.example.com", // Storage API URL
            "params": {
              "resultPath": "" // Path to access the credential or the link to the credential within the API response
            },
            // Optional parameters
            "options": {
              "method": "POST",
              "headers": {
                "Content-Type": "application/json"
              }
            }
          }
        }
      ]
    }
  ]
}
```

### Build the package

```bash
yarn build
```

### Start the project

```bash
yarn start
```

## Documentation

```
$ cd documentation
```

### Installation

```
$ yarn
```

### Local Development

```
$ yarn start
```

## Docker

- Dockerfile
  Build image

```bash
docker build --build-arg CONFIG_FILE=./app-config.json -t mock-app:latest .
```

Run image

```bash
docker run -p 3000:80 mock-app:latest
```

- Docker compose

```bash
docker-compose up
```
