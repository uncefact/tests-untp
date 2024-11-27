## untp-playground

## Getting Started

```bash
yarn dev
```

Open [http://localhost:3000/untp-playground](http://localhost:3000/untp-playground) with your browser to see the result.

## Deployment

We use Pulumi and GitHub actions to deploy the app. Please note that basePath is set to `/untp-playground`

GitHub cicd workflow requires the following secrets:

1. PULUMI_AWS_SECRET_KEY_ID
1. PULUMI_AWS_SECRET_ACCESS_KEY
1. PULUMI_CONFIG_PASSPHRASE

AWS credentials will be replaced with OIDC role in AWS account, Pulumi config encryption will be changed to awskms.

End-points:

1. test - https://test-playground.untp.showthething.com/untp-playground
1. production - https://test.uncefact.org/untp-playground

`next` branch is getting automatically deployed to test, tag is manually deployed to production.
In future production enddpoint will be replaced with a production url, and current endpoint will become test.

The production build is configured using Docker image https://nextjs.org/docs/pages/building-your-application/deploying#docker-image
