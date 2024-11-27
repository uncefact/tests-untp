import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

interface Props {
  stack: string;
}

export function configureNetwork({ stack }: Props) {
  const vpc = new awsx.ec2.Vpc(`vpc-${stack}`, {
    cidrBlock: "10.0.0.0/16",
    numberOfAvailabilityZones: 2,
    enableDnsHostnames: true,
  });

  const appSg = new aws.ec2.SecurityGroup(`api-${stack}`, {
    vpcId: vpc.vpcId,
    ingress: [
      { protocol: "tcp", fromPort: 3000, toPort: 3000, cidrBlocks: ["0.0.0.0/0"] },
      { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] }
    ],
    egress: [
      { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }
    ]
  });

  const lb = new awsx.lb.ApplicationLoadBalancer(`lb-${stack}`, {
    subnetIds: vpc.publicSubnetIds,
    defaultTargetGroup: {
      vpcId: vpc.vpcId,
      port: 3000,
      healthCheck: {
        path: "/untp-playground",
        interval: 30,
        timeout: 15,
        healthyThreshold: 2,
        unhealthyThreshold: 2,
      },
    },
    securityGroups: [appSg.id],
  });

  return { vpc, appSg, lb }
}