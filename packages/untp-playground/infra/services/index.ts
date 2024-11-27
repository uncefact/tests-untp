import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

interface Props {
  stack: string;
  vpc: awsx.ec2.Vpc;
}

export function configureServices({ stack, vpc }: Props) {
  const cluster = new aws.ecs.Cluster(`cluster-${stack}`);

  const namespace = new aws.servicediscovery.PrivateDnsNamespace(`namespace-${stack}`, {
    vpc: vpc.vpcId,
    name: "service.local",
  });

  return { cluster, namespace }
}

export * from './untp-playground';