import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as osis from "aws-cdk-lib/aws-osis";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";
import { CfnOutput, Stack } from "aws-cdk-lib";

export const defineOpenSearchDataSource = (
  backend: any,
  openSearchStack: Stack,
  todoTable: dynamodb.Table
) => {
  const openSearchDomain = new opensearch.Domain(
    openSearchStack,
    "OpenSearchDomain",
    {
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
      },
    }
  );

  const s3BackupBucket = new s3.Bucket(
    openSearchStack,
    "OpenSearchBackupBucketAmplifyGen2",
    {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: "opensearch-backup-bucket-amplify-gen-2-test1",
      enforceSSL: true,
      versioned: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    }
  );

  // Create an IAM role for OpenSearch integration
  const openSearchIntegrationPipelineRole = new iam.Role(
    openSearchStack,
    "OpenSearchIntegrationPipelineRole",
    {
      assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com"),
      inlinePolicies: {
        openSearchPipelinePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["es:DescribeDomain"],
              resources: [
                openSearchDomain.domainArn,
                openSearchDomain.domainArn + "/*",
              ],
              effect: iam.Effect.ALLOW,
            }),
            new iam.PolicyStatement({
              actions: ["es:ESHttp*"],
              resources: [
                openSearchDomain.domainArn,
                openSearchDomain.domainArn + "/*",
              ],
              effect: iam.Effect.ALLOW,
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "s3:GetObject",
                "s3:AbortMultipartUpload",
                "s3:PutObject",
                "s3:PutObjectAcl",
              ],
              resources: [
                s3BackupBucket.bucketArn,
                s3BackupBucket.bucketArn + "/*",
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "dynamodb:DescribeTable",
                "dynamodb:DescribeContinuousBackups",
                "dynamodb:ExportTableToPointInTime",
                "dynamodb:DescribeExport",
                "dynamodb:DescribeStream",
                "dynamodb:GetRecords",
                "dynamodb:GetShardIterator",
              ],
              resources: [
                "arn:aws:dynamodb:us-east-2:932080214319:table/Todo-tbadv7vxszgclbymvtl2vdjwmi-NONE",
                "arn:aws:dynamodb:us-east-2:932080214319:table/Todo-tbadv7vxszgclbymvtl2vdjwmi-NONE" +
                  "/*",
              ],
            }),
          ],
        }),
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonOpenSearchIngestionFullAccess"
        ),
      ],
    }
  );

  // Define OpenSearch index mappings
  const indexName = "todo";
  const indexMapping = {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      properties: {
        id: {
          type: "keyword",
        },
        isDone: {
          type: "boolean",
        },
        content: {
          type: "text",
        },
      },
    },
  };

  // OpenSearch template definition
  const openSearchTemplate = `
version: "2"
dynamodb-pipeline:
  source:
    dynamodb:
      acknowledgments: true
      tables:
        - table_arn: "arn:aws:dynamodb:us-east-2:932080214319:table/Todo-tbadv7vxszgclbymvtl2vdjwmi-NONE"
          stream:
            start_position: "LATEST"
          export:
            s3_bucket: "${s3BackupBucket.bucketName}"
            s3_region: "us-east-2"
            s3_prefix: "Todo-tbadv7vxszgclbymvtl2vdjwmi-NONE/"
      aws:
        sts_role_arn: "${openSearchIntegrationPipelineRole.roleArn}"
        region: "us-east-2"
  sink:
    - opensearch:
        hosts:
          - "https://${openSearchDomain.domainEndpoint}"
        index: "${indexName}"
        index_type: "custom"
        template_content: |
          ${JSON.stringify(indexMapping)}
        document_id: '\${getMetadata("primary_key")}'
        action: '\${getMetadata("opensearch_action")}'
        document_version: '\${getMetadata("document_version")}'
        document_version_type: "external"
        bulk_size: 4
        aws:
          sts_role_arn: "${openSearchIntegrationPipelineRole.roleArn}"
          region: "us-east-2"
`;

  const logGroup = new logs.LogGroup(openSearchStack, "LogGroup", {
    logGroupName: "/aws/vendedlogs/OpenSearchService/pipelines/1",
    removalPolicy: RemovalPolicy.DESTROY,
  });

  const cfnPipeline = new osis.CfnPipeline(
    openSearchStack,
    "OpenSearchIntegrationPipeline",
    {
      maxUnits: 4,
      minUnits: 1,
      pipelineConfigurationBody: openSearchTemplate,
      pipelineName: "dynamodb-integration-1",
      logPublishingOptions: {
        isLoggingEnabled: true,
        cloudWatchLogDestination: {
          logGroup: logGroup.logGroupName,
        },
      },
    }
  );
  // Export resources
  new CfnOutput(openSearchStack, "OpenSearchDomainArn", {
    description: "ARN of the OpenSearch domain",
    value: openSearchDomain.domainArn,
  });
  new CfnOutput(openSearchStack, "OpenSearchIntegrationRoleArn", {
    description: "ARN of the IAM role for OpenSearch integration",
    value: openSearchIntegrationPipelineRole.roleArn,
  });

  return backend.data.addOpenSearchDataSource("osDataSource", openSearchDomain);
};
