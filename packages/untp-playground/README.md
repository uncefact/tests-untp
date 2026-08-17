## untp-playground

## Getting Started

```bash
yarn dev
```

Open [http://localhost:3000/](http://localhost:3000/) with your browser to see the result.

## Usage

The homepage has three tabs: Credentials, Conformity Schemes, and Link Sets.

Drop a credential JSON or JWT file, or paste a URL, on the Credentials tab to validate it. Uploading a conformity scheme's JSON-LD file or URL on the Conformity Schemes tab validates it the same way. Each tab keeps validating in the background even while another tab is selected. Uploading content with the same hash as an artefact already loaded replaces that artefact in place. Different content is always added as a new one. Where a credential type or scheme appears more than once, the matching instances are grouped together under a shared header.

The Link Sets tab is a placeholder for a future release and does not yet accept uploads.

## Deployment

We use Pulumi and GitHub actions to deploy the app. See [infra/README.md](infra/README.md) for more details.

## Testing

We use Jest for testing.

To run tests:

```bash
yarn test
```

To run tests in watch mode:

```bash
yarn test:watch
```

To generate coverage report:

```bash
yarn test:coverage
```
