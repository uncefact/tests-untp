import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import * as docker_build from '@pulumi/docker-build';

export function deployApp() {
  const stack = pulumi.getStack();

  let awsConfig = new pulumi.Config('aws');
  let awsRegion = awsConfig.require('region');
  const appURL = new pulumi.Config().require('appURL');

  const vpc = new awsx.ec2.Vpc(`app-vpc-${stack}`, {
    cidrBlock: '10.0.0.0/16',
    numberOfAvailabilityZones: 2,
    enableDnsHostnames: true,
    natGateways: {
      strategy: awsx.ec2.NatGatewayStrategy.Single,
    },
  });

  const appSg = new aws.ec2.SecurityGroup(
    `app-sg-${stack}`,
    {
      vpcId: vpc.vpcId,
      ingress: [{ protocol: 'tcp', fromPort: 3000, toPort: 3000, cidrBlocks: ['0.0.0.0/0'] }],
      egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
    },
    {
      dependsOn: [vpc],
    },
  );

  const appLBSg = new aws.ec2.SecurityGroup(
    `app-lb-sg-${stack}`,
    {
      vpcId: vpc.vpcId,
      ingress: [
        { protocol: 'tcp', fromPort: 3000, toPort: 3000, cidrBlocks: ['0.0.0.0/0'] },
        { protocol: 'tcp', fromPort: 80, toPort: 80, cidrBlocks: ['0.0.0.0/0'] },
        { protocol: 'tcp', fromPort: 443, toPort: 443, cidrBlocks: ['0.0.0.0/0'] },
      ],
      egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
    },
    {
      dependsOn: [vpc],
    },
  );

  const targetGroup = new aws.lb.TargetGroup(
    `app-tg-${stack}`,
    {
      targetType: 'ip',
      vpcId: vpc.vpcId,
      port: 3000,
      protocol: 'HTTP',
      healthCheck: {
        path: process.env.NEXT_PUBLIC_BASE_PATH,
        interval: 30,
        timeout: 15,
        healthyThreshold: 2,
        unhealthyThreshold: 2,
      },
    },
    {
      dependsOn: [vpc],
    },
  );

  const lb = new awsx.lb.ApplicationLoadBalancer(
    `app-lb-${stack}`,
    {
      subnetIds: vpc.publicSubnetIds,
      securityGroups: [appLBSg.id],
      listeners: [
        {
          port: 443,
          protocol: 'HTTPS',
          sslPolicy: 'ELBSecurityPolicy-2016-08',
          certificateArn: 'arn:aws:acm:us-east-1:651690125008:certificate/ff8d87f3-f587-42cb-9edb-6badfad1937b',
          defaultActions: [
            {
              type: 'forward',
              targetGroupArn: targetGroup.arn,
            },
          ],
        },
        {
          port: 80,
          protocol: 'HTTP',
          defaultActions: [
            {
              type: 'redirect',
              redirect: {
                port: '443',
                protocol: 'HTTPS',
                statusCode: 'HTTP_301',
              },
            },
          ],
        },
      ],
    },
    {
      dependsOn: [vpc, appLBSg, targetGroup],
    },
  );

  const cluster = new aws.ecs.Cluster(`app-cluster-${stack}`);

  const appRepository = new aws.ecr.Repository(`app-ecr-${stack}`);
  const authToken = aws.ecr.getAuthorizationTokenOutput({
    registryId: appRepository.registryId,
  });

  const appImage = new docker_build.Image(`app-image-${stack}`, {
    // Tag our image with our ECR repository's address.
    tags: [pulumi.interpolate`${appRepository.repositoryUrl}:latest`],
    dockerfile: {
      location: '../../../packages/untp-playground/Dockerfile',
    },
    context: {
      location: '../../../',
    },
    // Use the pushed image as a cache source.
    cacheFrom: [
      {
        registry: {
          ref: pulumi.interpolate`${appRepository.repositoryUrl}:latest`,
        },
      },
    ],
    // Include an inline cache with our pushed image.
    cacheTo: [
      {
        inline: {},
      },
    ],
    platforms: ['linux/amd64'],
    buildArgs: {
      ...(process.env.NEXT_PUBLIC_BASE_PATH && { NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH }),
      ...(process.env.NEXT_PUBLIC_ASSET_PREFIX && { NEXT_PUBLIC_ASSET_PREFIX: process.env.NEXT_PUBLIC_ASSET_PREFIX }),
      ...(process.env.NEXT_PUBLIC_IMAGE_PATH && { NEXT_PUBLIC_IMAGE_PATH: process.env.NEXT_PUBLIC_IMAGE_PATH }),
      ...(process.env.NEXT_PUBLIC_REPORT_NAME && { NEXT_PUBLIC_REPORT_NAME: process.env.NEXT_PUBLIC_REPORT_NAME }),
    },
    // Push the final result to ECR.
    push: true,
    // Provide our ECR credentials.
    registries: [
      {
        address: appRepository.repositoryUrl,
        password: authToken.password,
        username: authToken.userName,
      },
    ],
  });

  const service = new awsx.ecs.FargateService(
    `app-service-${stack}`,
    {
      cluster: cluster.arn,
      desiredCount: 1,
      taskDefinitionArgs: {
        container: {
          name: `app-${stack}`,
          image: appImage.ref,
          cpu: 128,
          memory: 512,
          essential: true,
          portMappings: [
            {
              containerPort: 3000,
              targetGroup: targetGroup,
            },
          ],
        },
      },
      networkConfiguration: {
        subnets: vpc.publicSubnetIds,
        securityGroups: [appSg.id],
        assignPublicIp: true,
      },
    },
    {
      dependsOn: [vpc, appSg, targetGroup, cluster, lb],
    },
  );
  return appURL;
}
