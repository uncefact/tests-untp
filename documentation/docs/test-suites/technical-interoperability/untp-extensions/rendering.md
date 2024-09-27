---
sidebar_position: 7
title: Rendering
---

import Disclaimer from '../../../\_disclaimer.mdx';

<Disclaimer />

The Rendering component of the UNTP extensions focuses on how credential data is visually presented. It utilises a `Render Template`, which is crucial in ensuring consistent and flexible presentation of product information across different systems and applications. To support uptake across supply chain actors with varying levels of technical maturity, human rendering of digital credentials is essential.

## Render Template Structure

The Render Template is defined within the credential's `renderMethod` property. It includes the following key elements:

- `name`: An optional identifier for the template
- `template`: The HTML structure with placeholders for dynamic content
- `@type`: The type of rendering template (e.g., "RenderTemplate2024")
- `mediaType`: The MIME type of the rendered output (typically "text/html")
- `mediaQuery`: Optional CSS media queries for responsive design
- `digestMultibase`: A hash of the template for integrity verification

## Example Input

Here's an example of a credential with a render method:

```json
{
  "credential": {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      {
        "ex": "https://www.w3.org/2018/credentials#renderMethod#",
        "renderMethod": "https://www.w3.org/2018/credentials#renderMethod",
        "template": "ex:template",
        "url": "ex:url",
        "mediaQuery": "ex:mediaQuery"
      }
    ],
    "renderMethod": [
      {
        "name": "template name",
        "template": "<p>{{credentialSubject.name}}</p>",
        "@type": "RenderTemplate2024",
        "mediaType": "text/html",
        "mediaQuery": "@media (min-width: 1024px) {.name {font-weight: bold}}",
        "digestMultibase": "zQmXF936JrjET6pCRdTfs5czN8Ch65NHfsGqKkAwwLkviHA"
      }
    ],
    "credentialSubject": {
      "name": "Jane Doe"
    }
  }
}
```

## Expected Output

A successful render should return a response in the following format:

```json
{
  "documents": [
    {
      "type": "RenderTemplate2024",
      "renderedTemplate": "PHN0eWxlPkBtZWRpYSAobWluLXdpZHRoOiAxMDI0cHgpIHsubmFtZSB7Zm9udC13ZWlnaHQ6IGJvbGR9fTwvc3R5bGU+PHA+SmFuZSBEb2U8L3A+",
      "name": "template name"
    }
  ]
}
```

The `renderedTemplate` is a base64-encoded string representing the final HTML output, including any specified styles and the rendered credential data.

## Testing

To test your Rendering implementation, follow these steps:

1. **Configure the Test Suite**:

   - Navigate to the config file: `packages/vc-test-suite/config.ts`
   - Update the `RenderTemplate2024` section:

   ```javascript
   export default {
     implementationName: 'UNTP ACME',
     testSuites: {
       RenderTemplate2024: {
         url: 'http://localhost:3332/agent/renderCredential',
         headers: {},
         method: 'POST',
       },
     },
   };
   ```

   - Adjust the `url`, `headers`, and `method` as necessary for your implementation.

2. **Run the Test**:

   - Navigate to `packages/vc-test-suite`
   - In your terminal, run the command: `yarn test`

3. **View Test Results**:
   - Navigate to `packages/vc-test-suite/reports/index.html`
   - Open this file in a web browser
   - Look for the "RenderTemplate2024" section to view your test results
