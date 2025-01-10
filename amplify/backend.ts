import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";

import { Stack } from "aws-cdk-lib";
import { storage } from "./storage/resource";

import * as osis from "aws-cdk-lib/aws-osis";
import * as iam from "aws-cdk-lib/aws-iam";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { RemovalPolicy, aws_ec2 } from "aws-cdk-lib";

// Define backend resources
const backend = defineBackend({
  auth,
  data,
  storage,
});

// Get the data stack
//const openSearchStack = Stack.of(backend.data);
const openSearchStack = backend.data.stack;
// // Get the DynamoDB table
const todoTable =
  backend.data.resources.cfnResources.amplifyDynamoDbTables["Todo"];

// Update table settings
todoTable.pointInTimeRecoveryEnabled = true;
todoTable.streamSpecification = {
  streamViewType: dynamodb.StreamViewType.NEW_IMAGE,
};

// Get the DynamoDB table ARN
const tableArn = backend.data.resources.tables["Todo"].tableArn;
// Get the DynamoDB table name
const tableName = backend.data.resources.tables["Todo"].tableName;

//Get the region
const region = openSearchStack.region;

// Create the OpenSearch domain
const openSearchDomain = new opensearch.Domain(
  openSearchStack,
  "OpenSearchDomain",
  {
    version: opensearch.EngineVersion.OPENSEARCH_2_3,

    nodeToNodeEncryption: true,
    removalPolicy: RemovalPolicy.DESTROY,
    encryptionAtRest: {
      enabled: true,
    },
    //add cluster config
    capacity: {
      masterNodeInstanceType: "t3.small.search",
      masterNodes: 0,
      dataNodeInstanceType: "t3.small.search",
      dataNodes: 1,
    },
    ebs: {
      // Minimum EBS volume size
      volumeSize: 10,
      volumeType: aws_ec2.EbsDeviceVolumeType.GP3,
    },
  }
);

const s3BucketArn = backend.storage.resources.bucket.bucketArn;
const s3BucketName = backend.storage.resources.bucket.bucketName;

const domainArn = openSearchDomain.domainArn;
const exportPath = "exported-data";

/**
 * Policy for DynamoDB export operations
 * Allows:
 * - Describing table configuration
 * - Checking backup capabilities
 * - Initiating table exports
 */
const dynamoDBExportJobPolicy = new iam.PolicyStatement({
  sid: "allowRunExportJob",
  effect: iam.Effect.ALLOW,
  actions: [
    // Required for getting table metadata before export
    "dynamodb:DescribeTable",
    // Required for verifying point-in-time recovery status
    "dynamodb:DescribeContinuousBackups",
    // Required for initiating table export operation
    "dynamodb:ExportTableToPointInTime",
  ],
  resources: [tableArn, tableArn + "/*"],
});

/**
 * Policy for monitoring export job status
 * Allows:
 * - Checking status of ongoing export operations
 * - Monitoring export progress
 * Note: Uses wildcard for export operations as export IDs are dynamically generated
 */
const dynamoDBExportCheckPolicy = new iam.PolicyStatement({
  sid: "allowCheckExportjob",
  effect: iam.Effect.ALLOW,
  actions: ["dynamodb:DescribeExport"],
  resources: [tableArn, tableArn + "/*"],
});

/**
 * Policy for DynamoDB Stream operations
 * Allows:
 * - Reading stream metadata
 * - Accessing stream records
 * - Managing stream iterators
 * Required for real-time data synchronization
 */
const dynamoDBStreamPolicy = new iam.PolicyStatement({
  sid: "allowReadFromStream",
  effect: iam.Effect.ALLOW,
  actions: [
    // Required for getting stream metadata
    "dynamodb:DescribeStream",
    // Required for reading actual records from the stream
    "dynamodb:GetRecords",
    // Required for managing stream position
    "dynamodb:GetShardIterator",
  ],
  resources: [tableArn, tableArn + "/*"],
});

/**
 * Policy for S3 operations during export
 * Allows:
 * - Reading exported data
 * - Writing export files
 * - Managing multipart uploads
 * - Setting object ACLs
 * Scoped to specific export path for security
 */
const s3ExportPolicy = new iam.PolicyStatement({
  sid: "allowReadAndWriteToS3ForExport",
  effect: iam.Effect.ALLOW,
  actions: [
    // Required for reading exported data
    "s3:GetObject",
    // Required for handling failed uploads
    "s3:AbortMultipartUpload",
    // Required for writing export files
    "s3:PutObject",
    // Required for setting object permissions
    "s3:PutObjectAcl",
  ],
  resources: [`${s3BucketArn}/${exportPath}/*`],
});

/**
 * Policy for OpenSearch domain access
 * Allows:
 * - HTTP operations for indexing and querying
 * - Domain management operations
 * Includes permissions for both domain-level and index-level operations
 */
const openSearchDomainPolicy = new iam.PolicyStatement({
  sid: "allowOpenSearchAccess",
  effect: iam.Effect.ALLOW,
  actions: [
    // Required for reading data and cluster status
    "es:ESHttpGet",
    // Required for updating documents and settings
    "es:ESHttpPut",
    // Required for creating new documents and indices
    "es:ESHttpPost",
    // Required for removing documents and indices
    "es:ESHttpDelete",
    // Required for getting domain configuration
    "es:DescribeDomain",
  ],
  // Grant access to both domain and all indices/operations within it
  resources: [domainArn, `${domainArn}/*`],
});

/**
 * Combines all policy statements into a single policy document
 * This creates a comprehensive set of permissions required for
 * the OpenSearch integration pipeline
 */
const policyDocument = new iam.PolicyDocument({
  statements: [
    dynamoDBExportJobPolicy,
    dynamoDBExportCheckPolicy,
    dynamoDBStreamPolicy,
    s3ExportPolicy,
    openSearchDomainPolicy,
  ],
});

/**
 * Creates an IAM role for the OpenSearch integration pipeline
 * @param stack - The CDK stack
 * @param policyDocument - Policy document containing all required permissions
 * @returns IAM Role configured for OpenSearch integration
 */
// const openSearchIntegrationPipelineRole = new iam.Role(
//   openSearchStack,
//   "OpenSearchIntegrationPipelineRole",
//   {
//     // Role name should be unique within the account
//     roleName: `OpenSearchIntegrationPipelineRole`,
//     description:
//       "Role for OpenSearch Integration Pipeline with DynamoDB and S3",
//     // Allow OpenSearch Ingestion Service to assume this role
//     assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com"),
//     // Attach the custom policy document
//     inlinePolicies: {
//       "open-search-integration-policy": policyDocument,
//     },
//     // Attach AWS managed policy for additional OpenSearch ingestion permissions
//     managedPolicies: [
//       iam.ManagedPolicy.fromAwsManagedPolicyName(
//         "AmazonOpenSearchIngestionFullAccess"
//       ),
//     ],
//   }
// );

// Create an IAM role for OpenSearch integration
const openSearchIntegrationPipelineRole2 = new iam.Role(
  openSearchStack,
  "OpenSearchIntegrationPipelineRole2",
  {
    assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com"),
    inlinePolicies: {
      "open-search-integration-policy": policyDocument,
    },

    // inlinePolicies: {
    //   openSearchPipelinePolicy: new iam.PolicyDocument({
    //     statements: [
    //       new iam.PolicyStatement({
    //         actions: ["es:DescribeDomain"],
    //         resources: [
    //           openSearchDomain.domainArn,
    //           openSearchDomain.domainArn + "/*",
    //         ],
    //         effect: iam.Effect.ALLOW,
    //       }),
    //       new iam.PolicyStatement({
    //         actions: ["es:ESHttp*"],
    //         resources: [
    //           openSearchDomain.domainArn,
    //           openSearchDomain.domainArn + "/*",
    //         ],
    //         effect: iam.Effect.ALLOW,
    //       }),
    //       new iam.PolicyStatement({
    //         effect: iam.Effect.ALLOW,
    //         actions: [
    //           "s3:GetObject",
    //           "s3:AbortMultipartUpload",
    //           "s3:PutObject",
    //           "s3:PutObjectAcl",
    //         ],
    //         resources: [s3BucketArn, s3BucketArn + "/*"],
    //       }),
    //       new iam.PolicyStatement({
    //         effect: iam.Effect.ALLOW,
    //         actions: [
    //           "dynamodb:DescribeTable",
    //           "dynamodb:DescribeContinuousBackups",
    //           "dynamodb:ExportTableToPointInTime",
    //           "dynamodb:DescribeExport",
    //           "dynamodb:DescribeStream",
    //           "dynamodb:GetRecords",
    //           "dynamodb:GetShardIterator",
    //         ],
    //         resources: [tableArn, tableArn + "/*"],
    //       }),
    //     ],
    //   }),
    // },
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
      done: {
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
        - table_arn: "${tableArn}"
          stream:
            start_position: "LATEST"
          export:
            s3_bucket: "${s3BucketName}"
            s3_region: "${region}"
            s3_prefix: "${tableName}/"
      aws:
        sts_role_arn: "${openSearchIntegrationPipelineRole2.roleArn}"
        region: "${region}"
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
          region: "${region}"
`;

// Create a CloudWatch log group
const logGroup = new LogGroup(openSearchStack, "LogGroup", {
  logGroupName: "/aws/vendedlogs/OpenSearchService/pipelines/3",
  removalPolicy: RemovalPolicy.DESTROY,
});

// Create an OpenSearch Integration Service pipeline
const cfnPipeline = new osis.CfnPipeline(
  openSearchStack,
  "OpenSearchIntegrationPipeline",
  {
    maxUnits: 4,
    minUnits: 1,
    pipelineConfigurationBody: openSearchTemplate,
    pipelineName: "dynamodb-integration-3",
    logPublishingOptions: {
      isLoggingEnabled: true,
      cloudWatchLogDestination: {
        logGroup: logGroup.logGroupName,
      },
    },
  }
);
// Add OpenSearch data source
const osDataSource = backend.data.addOpenSearchDataSource(
  "osDataSource",
  openSearchDomain
);
