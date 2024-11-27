import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

interface Props {
  stack: string;
  env: string;
  vpc: awsx.ec2.Vpc;
  cluster: aws.ecs.Cluster;
  appSg: aws.ec2.SecurityGroup;
  lb: awsx.lb.ApplicationLoadBalancer;
}

export function configureApp({ stack, env, vpc, cluster, appSg, lb }: Props) {
  const appRepository = new awsx.ecr.Repository(`app-${stack}`);

  const appImage = new awsx.ecr.Image(`app-${stack}`, {
    repositoryUrl: appRepository.url,
    platform: 'linux/amd64',
    context: "../"
  });

  const appService = new awsx.ecs.FargateService("app-service", {
    cluster: cluster.arn,
    taskDefinitionArgs: {
      container: {
        name: `app-${stack}`,
        image: appImage.imageUri,
        cpu: 128,
        memory: 256,
        portMappings: [
          { containerPort: 3000, targetGroup: lb.defaultTargetGroup },
        ],
      },
    },
    networkConfiguration: {
      subnets: vpc.publicSubnetIds,
      securityGroups: [appSg.id],
      assignPublicIp: true
    },
    desiredCount: 1,
  });
}