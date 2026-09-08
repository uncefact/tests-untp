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

On the Link Sets tab, drop a link set JSON file or resolve an identity resolver URL to fetch its link set (the request automatically carries `?linkType=all` unless the URL already specifies a `linkType`). Each resolved link set is a card identified by the exact URL requested, so re-resolving the same URL replaces its card in place rather than adding a duplicate. An uploaded file is identified by its filename. Expanding a card lists the links that identify as UNTP credentials (by relation type or verifiable-credential media type), lists secondary identity resolver links (`idr` relation with a link set target) with a Resolve action that loads each as its own card, and counts the rest without listing them. A target the link set marks as encrypted carries an Encrypted tag. Removing a card is immediate, with a toast offering a single-level Undo rather than a confirm dialog. Each link set is validated against the UNTP linkset JSON Schema for the spec version selected under the "Add a link set" heading (v0.7.0 today). The card's subtitle names the version it was checked against, and a failed step lists each offending path with the rule it broke. A second step, Link Type Coverage, compares each verified linked credential's detected type with the relation it was linked under (a `dcc` link that resolves to a Digital Product Passport fails it) and shows how many relation links have been checked. See [Validating link sets](../../documentation/docs-playground/validating-link-sets.md) for what each step does and does not check.

Each listed credential link has a Verify action that fetches the target and, once accepted into the credentials pipeline, tracks its validation state on the row, in step with the same instance on the Credentials tab. A body that turns out to be an encrypted envelope is accepted as a locked instance, grouped separately under an Encrypted heading on the Credentials tab, rather than joining the typed groups. A later fetch of the same URL that yields nothing acceptable, from either the row or the Credentials tab, returns the row to its Verify action.

An encrypted instance's card shows a decrypt panel instead of a pipeline. For the canonical storage envelope (base64 `cipherText`, `iv`, `tag`, AES-256-GCM), entering the matching 64-character hex key decrypts it entirely in the browser with WebCrypto and, on success, runs the credential through the normal validation pipeline with a leading Decryption step; the key is held only in component state for that call and is never stored, logged, or sent anywhere. Other encrypted forms (JWE, other AES variants, or anything outside that exact envelope shape) stay locked with copy explaining that the Playground cannot decrypt them yet, so the panel never solicits a key that could not work. If decrypting produces content matching an instance already loaded, the two merge into one rather than creating a duplicate. Locked instances are left out of the generated report and do not hold it up; an unlocked instance still awaiting a result holds report generation until it settles.

## Reports

Generate Report records every loaded credential, conformity scheme and link set with its results, and Download Report saves it as HTML or JSON. The button is available once at least one reportable artefact is loaded (a locked credential alone does not count), every credential and scheme has settled, and every link set's Schema Validation step has; a link set's Link Type Coverage step may still be pending in the report, since it counts only the links that have been verified. The HTML groups credentials by type with counts and titles each block as its card is titled; the JSON carries three family arrays (`verifiableCredentials`, `conformitySchemes`, `linkSets`), always present. Any change to the loaded artefacts, URL bindings or credential results discards a generated report. See the [reports documentation](../../documentation/docs-playground/generating-reports.md).

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
