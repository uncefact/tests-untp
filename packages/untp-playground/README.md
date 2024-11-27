## untp-playground

## Getting Started

```bash
yarn dev
```

Open [http://localhost:3000/](http://localhost:3000/) with your browser to see the result.

## Deployment

We use Pulumi and GitHub actions to deploy the app. The following env variables needs to be set to define basePath in order to it work with the existing CloudFront Distribution:
```
NEXT_PUBLIC_BASE_PATH: /untp-playground
NEXT_PUBLIC_ASSET_PREFIX: /untp-playground
NEXT_PUBLIC_IMAGE_PATH: /untp-playground/_next/image
```

GitHub cicd workflow requires the following secrets:

1. PULUMI_AWS_SECRET_KEY_ID
1. PULUMI_AWS_SECRET_ACCESS_KEY

AWS credentials will be replaced with OIDC role in AWS account, Pulumi config encryption has be changed to awskms.

End-points:

1. test - https://test.uncefact.org/test-untp-playground
1. production - https://test.uncefact.org/untp-playground

`next` branch is getting automatically deployed to test, tag is manually deployed to production.
In future production enddpoint will be replaced with a production url, and current endpoint will become test.

The production build is configured using Docker image https://nextjs.org/docs/pages/building-your-application/deploying#docker-image
