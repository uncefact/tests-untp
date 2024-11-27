import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export function configureBase (){
let awsConfig = new pulumi.Config('aws');
let awsRegion = awsConfig.require('region');
const current = aws.getCallerIdentity({});
const kmsKey = new aws.kms.Key("base", {
    description: "default key used for untp-playground",
    enableKeyRotation: true,
    deletionWindowInDays: 20,
    policy: JSON.stringify({
        Version: "2012-10-17",
        Id: "key-default-1",
        Statement: [{
            Action: "kms:*",
            Effect: "Allow",
            Principal: {
                AWS: "*",
            },
            Resource: "*",
            Sid: "Enable IAM User Permissions",
        }],
    }),
},
{protect: false});

const keyAlias = new aws.kms.Alias("alias", {
    name: "alias/untp-pg-base",
    targetKeyId: kmsKey.keyId,
},
{protect: false});

const secretProviderURL = `awskms://${keyAlias}?region=${awsRegion}`;
return secretProviderURL;
}
