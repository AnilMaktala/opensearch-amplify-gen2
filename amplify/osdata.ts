import { defineOpenSearchDataSource } from "./opensearch";
import { auth } from "./auth/resource";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as osis from "aws-cdk-lib/aws-osis";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";
import { CfnOutput, Stack } from "aws-cdk-lib";
export const osdata = {
  auth,
  addOpenSearchDataSource: defineOpenSearchDataSource,

  // Define other data configurations here
  todoTable: dynamodb.Table,
};
