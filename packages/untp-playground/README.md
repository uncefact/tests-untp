## untp-playground

## Getting Started

```bash
pnpm dev
```

Open [http://localhost:3000/](http://localhost:3000/) with your browser to see the result.

## Usage

The homepage has three tabs: Credentials, Conformity Schemes, and Link Sets.

Drop a credential JSON or JWT file, or paste a URL, on the Credentials tab to validate it. Uploading a conformity scheme's JSON-LD file or URL on the Conformity Schemes tab validates it the same way. Each tab keeps validating in the background even while another tab is selected. Uploading content with the same hash as an artefact already loaded replaces that artefact in place. Different content is always added as a new one. Where a credential type or scheme appears more than once, the matching instances are grouped together under a shared header.

A tab's label shows a count of its loaded instances, and a small red dot next to the count if any of them has failed. The Credentials tab also shows a spinner while any credential is still being validated, so background progress on an inactive tab stays visible without switching to it. A tab with no loaded instances shows no count.

On the Link Sets tab, resolve an identity resolver URL to fetch its link set (the request automatically carries `?linkType=all` unless the URL already specifies a `linkType`). Each resolved link set is a card identified by the exact URL requested, so re-resolving the same URL replaces its card in place rather than adding a duplicate. Expanding a card lists the links that identify as UNTP credentials (by relation type or verifiable-credential media type), lists secondary identity resolver links (`idr` relation with a link set target) with a Resolve action that loads each as its own card, and counts the rest without listing them. A target the link set marks as encrypted carries an Encrypted tag. Removing a card is immediate, with a toast offering a single-level Undo rather than a confirm dialog. Schema validation of a resolved link set is not yet implemented: every card shows its validation step as pending.

Each listed credential link has a Verify action that fetches the target and, once accepted into the credentials pipeline, tracks its validation state on the row, in step with the same instance on the Credentials tab. A body that turns out to be an encrypted envelope is reported as encrypted rather than validated; decryption is not yet supported.

## Deployment

We use Pulumi and GitHub actions to deploy the app. See [infra/README.md](infra/README.md) for more details.

## Testing

We use Jest for testing.

To run tests:

```bash
pnpm test
```

To run tests in watch mode:

```bash
pnpm test:watch
```

To generate coverage report:

```bash
pnpm test:coverage
```
