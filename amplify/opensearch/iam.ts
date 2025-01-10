import * as iam from "aws-cdk-lib/aws-iam";
import { Stack } from "aws-cdk-lib";

interface OpenSearchIntegrationRoleProps {
  domainArn: string;
  tableArn: string;
  s3BucketArn: string;
  exportPath?: string;
}

export const createOpenSearchIntegrationRole = (
  stack: Stack,
  props: OpenSearchIntegrationRoleProps
) => {
  const { domainArn, tableArn, s3BucketArn, exportPath = "*" } = props;

  // Export job operations policy
  const dynamoDBExportJobPolicy = new iam.PolicyStatement({
    sid: "allowRunExportJob",
    effect: iam.Effect.ALLOW,
    actions: [
      "dynamodb:DescribeTable",
      "dynamodb:DescribeContinuousBackups",
      "dynamodb:ExportTableToPointInTime",
    ],
    resources: [tableArn],
  });

  // Export check operations policy
  const dynamoDBExportCheckPolicy = new iam.PolicyStatement({
    sid: "allowCheckExportjob",
    effect: iam.Effect.ALLOW,
    actions: ["dynamodb:DescribeExport"],
    resources: [`${tableArn}/export/*`],
  });

  // Stream operations policy
  const dynamoDBStreamPolicy = new iam.PolicyStatement({
    sid: "allowReadFromStream",
    effect: iam.Effect.ALLOW,
    actions: [
      "dynamodb:DescribeStream",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
    ],
    resources: [`${tableArn}/stream/*`],
  });

  // S3 access policy for export
  const s3ExportPolicy = new iam.PolicyStatement({
    sid: "allowReadAndWriteToS3ForExport",
    effect: iam.Effect.ALLOW,
    actions: [
      "s3:GetObject",
      "s3:AbortMultipartUpload",
      "s3:PutObject",
      "s3:PutObjectAcl",
    ],
    resources: [`${s3BucketArn}/${exportPath}/*`],
  });

  // OpenSearch domain access policy
  const openSearchDomainPolicy = new iam.PolicyStatement({
    sid: "allowOpenSearchAccess",
    effect: iam.Effect.ALLOW,
    actions: [
      "es:ESHttpGet",
      "es:ESHttpPut",
      "es:ESHttpPost",
      "es:ESHttpDelete",
      "es:DescribeDomain",
    ],
    resources: [domainArn, `${domainArn}/*`],
  });

  // Combine all policies into a single policy document
  const policyDocument = new iam.PolicyDocument({
    statements: [
      dynamoDBExportJobPolicy,
      dynamoDBExportCheckPolicy,
      dynamoDBStreamPolicy,
      s3ExportPolicy,
      openSearchDomainPolicy,
    ],
  });

  // Create the IAM role with all policies
  const role = new iam.Role(stack, "OpenSearchIntegrationPipelineRole", {
    roleName: `OpenSearchIntegrationPipelineRole`,
    description: "Role for OpenSearch Integration Pipeline",
    assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com"),
    inlinePolicies: {
      OpenSearchIntegrationPolicy: policyDocument,
    },
    // managedPolicies: [
    //   iam.ManagedPolicy.fromAwsManagedPolicyName(
    //     "service-role/AWSOpenSearchIngestionServiceRole"
    //   ),
    // ],
  });

  return role;
};

// Helper function to create a DynamoDB export policy
export const createDynamoDBExportPolicy = (
  tableArn: string,
  s3BucketArn: string,
  exportPath: string
) => {
  const policyDocument = new iam.PolicyDocument({
    statements: [
      new iam.PolicyStatement({
        sid: "allowRunExportJob",
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:DescribeTable",
          "dynamodb:DescribeContinuousBackups",
          "dynamodb:ExportTableToPointInTime",
        ],
        resources: [tableArn],
      }),
      new iam.PolicyStatement({
        sid: "allowCheckExportjob",
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:DescribeExport"],
        resources: [`${tableArn}/export/*`],
      }),
      new iam.PolicyStatement({
        sid: "allowReadAndWriteToS3ForExport",
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:AbortMultipartUpload",
          "s3:PutObject",
          "s3:PutObjectAcl",
        ],
        resources: [`${s3BucketArn}/${exportPath}/*`],
      }),
    ],
  });

  return policyDocument;
};

// Example usage in backend.ts:
/*
import { createOpenSearchIntegrationRole } from './iam';

const role = createOpenSearchIntegrationRole(stack, {
  domainArn: openSearchDomain.domainArn,
  tableArn: "arn:aws:dynamodb:us-east-1:account-id:table/my-table",
  s3BucketArn: "arn:aws:s3:::my-bucket",
  exportPath: "exportPath"
});

// Or create just the export policy
const exportPolicy = createDynamoDBExportPolicy(
  "arn:aws:dynamodb:us-east-1:account-id:table/my-table",
  "arn:aws:s3:::my-bucket",
  "exportPath"
);
*/
