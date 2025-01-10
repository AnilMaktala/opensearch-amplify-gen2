import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import * as locations from "aws-cdk-lib/aws-location";
import { Construct } from "constructs";
import * as osis from "aws-cdk-lib/aws-osis";
import * as iam from "aws-cdk-lib/aws-iam";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib";
export class OpenSearchStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create the map resource
    const map = new locations.CfnMap(this, "LocationMap", {
      configuration: {
        style: "VectorEsriStreets", // map style
      },
      description: "My Location Map",
      mapName: "MyMap",
    });

    new CfnOutput(this, "mapArn", {
      value: map.attrArn,
      exportName: "mapArn",
    });
  }
}
