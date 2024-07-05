# `vc-test-suite`

## Installation

```bash
yarn install
```

## Setup

There are two parts of the test suite: `Render Template 2024` and `QR Link Encryption`. To add your implementation to this test suite you will need to add 2 endpoints to your implementation manifest in `config.ts`:
- A Render Template 2024 endpoint in the `RenderTemplate2024` property.
- An Encrypted QR Link in the `QrLinkEncrypted` property.

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
