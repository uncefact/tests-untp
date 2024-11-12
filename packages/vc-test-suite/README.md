# `vc-test-suite`

## Installation

```bash
yarn install
```

## Setup

There are three parts of the test suite: `Render Template 2024`, `QR Link Encryption` and `Storage`. To add your implementation to this test suite you will need to add some endpoints to your implementation manifest in `config.ts`:

- A Render Template 2024 endpoint in the `RenderTemplate2024` property.
- An Encrypted QR Link in the `QrLinkEncrypted` property.
- An Unencrypted QR Link in the `QrLinkUnencrypted` property.
- A Storage endpoint in the `Storage` property.

> **IMPORTANT**: Please change the url in the `config.ts` file to match your implementation.

## Usage

Create a folder named reports in the root directory of the test suite project (`vc-test-suite`):

```bash
mkdir reports
```

### Run the Tests:

Finally, run the tests with the following command:

```bash
yarn test
```

### View the Report:

Open the generated report HTML file in the reports folder to check the results.

## Developer

### Run package tests

```bash
yarn test:package
```

### Additional Documentation

- [Technical Interoperability](https://uncefact.github.io/tests-untp/docs/test-suites/technical-interoperability/)
- [Verify Link](https://uncefact.github.io/tests-untp/docs/mock-apps/common/verify-link)
