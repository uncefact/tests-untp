import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';

const stack = pulumi.getStack();

let awsConfig = new pulumi.Config('aws');
let awsRegion = awsConfig.require('region');

const domainName = new pulumi.Config().require('domain');

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

const cert = new aws.acm.Certificate(`app-cert-${stack}`, {
  domainName: domainName,
  validationMethod: 'DNS',
  validationOptions: [
    {
      domainName: domainName,
      validationDomain: 'untp.showthething.com',
    },
  ],
});

const targetGroup = new aws.lb.TargetGroup(
  `app-tg-${stack}`,
  {
    targetType: 'ip',
    vpcId: vpc.vpcId,
    port: 3000,
    protocol: 'HTTP',
    healthCheck: {
      path: '/untp-playground',
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
        certificateArn: cert.arn,
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
    dependsOn: [vpc, appLBSg, targetGroup, cert],
  },
);

const cluster = new aws.ecs.Cluster(`app-cluster-${stack}`);

const appRepository = new awsx.ecr.Repository(`app-ecr-${stack}`);

const appImage = new awsx.ecr.Image(`app-image-${stack}`, {
  repositoryUrl: appRepository.url,
  platform: 'linux/amd64',
  context: '../',
  args: {
    ...(process.env.NEXT_PUBLIC_BASE_PATH && { NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH }),
    ...(process.env.NEXT_PUBLIC_ASSET_PREFIX && { NEXT_PUBLIC_ASSET_PREFIX: process.env.NEXT_PUBLIC_ASSET_PREFIX }),
    ...(process.env.NEXT_PUBLIC_IMAGE_PATH && { NEXT_PUBLIC_IMAGE_PATH: process.env.NEXT_PUBLIC_IMAGE_PATH }),
  },
});

const service = new awsx.ecs.FargateService(
  `app-service-${stack}`,
  {
    cluster: cluster.arn,
    desiredCount: 1,
    taskDefinitionArgs: {
      container: {
        name: `app-${stack}`,
        image: appImage.imageUri,
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

export const url = pulumi.interpolate`https://${domainName}/untp-playground`;
