import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as osis from "aws-cdk-lib/aws-osis";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Stack } from "aws-cdk-lib";
const backend = defineBackend({
  auth,
  data,
});

// Enable PITR (required for zero-ETL integration)
const todoTable =
  backend.data.resources.cfnResources.amplifyDynamoDbTables["Todo"];
todoTable.pointInTimeRecoveryEnabled = true;
todoTable.streamSpecification = {
  streamViewType: dynamodb.StreamViewType.NEW_IMAGE,
};

const openSearchStack = backend.createStack("OpenSearchStack");
//dataStack.addDependency(openSearchStack);

const tableArn = backend.data.resources.tables["Todo"].tableArn;

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
            resources: [openSearchDomain.domainArn],
            effect: iam.Effect.ALLOW,
          }),
          new iam.PolicyStatement({
            actions: ["es:ESHttp*"],
            resources: [openSearchDomain.domainArn],
            effect: iam.Effect.ALLOW,
          }),
        ],
      }),
    },
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonOpenSearchServiceFullAccess"
      ),
    ],
  }
);

openSearchIntegrationPipelineRole.addToPolicy(
  new iam.PolicyStatement({
    actions: [
      "s3:ListObjects",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:ListBucket",
      "s3:DeleteBucket",
    ],
    resources: [
      s3BackupBucket.bucketArn,
      s3BackupBucket.bucketArn,
      openSearchDomain.domainArn,
    ],
    effect: iam.Effect.ALLOW,
  })
);

openSearchIntegrationPipelineRole.addToPolicy(
  new iam.PolicyStatement({
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
      "arn:aws:dynamodb:us-east-2:932080214319:table/Todo-csnqx24o4bf3tanskg45nxureu-NONE",
      "arn:aws:dynamodb:us-east-2:932080214319:table/Todo-csnqx24o4bf3tanskg45nxureu-NONE/*",
      openSearchDomain.domainArn,
    ],
    effect: iam.Effect.ALLOW,
  })
);
openSearchIntegrationPipelineRole.addManagedPolicy(
  iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonDynamoDBFullAccess")
);
openSearchIntegrationPipelineRole.addManagedPolicy(
  iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
);

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

const openSearchTemplate = `
version: "2"
dynamodb-pipeline:
  source:
    dynamodb:
      acknowledgments: true
      tables:
        - table_arn: "arn:aws:dynamodb:us-east-2:932080214319:table/Todo-csnqx24o4bf3tanskg45nxureu-NONE"
          # Remove the stream block if only export is needed
          stream:
            start_position: "LATEST"
          # Remove the export block if only stream is needed
          export:
            s3_bucket: "${s3BackupBucket.bucketName}"
            s3_region: "us-east-2"
            s3_prefix: "Todo-csnqx24o4bf3tanskg45nxureu-NONE/"
      aws:
        sts_role_arn: "${openSearchIntegrationPipelineRole.roleArn}"
        region: "us-east-2"
  sink:
    - opensearch:
        hosts:
          [
            "https://${openSearchDomain.domainEndpoint}",
          ]
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
    pipelineName: "dynamodb-integration-2",
    logPublishingOptions: {
      isLoggingEnabled: true,
      cloudWatchLogDestination: {
        logGroup: logGroup.logGroupName,
      },
    },
  }
);

// const osDataSource = backend.data.addOpenSearchDataSource(
//   "osDataSource",
//   openSearchDomain
// );

// osDataSource.grantPrincipal.addToPrincipalPolicy(
//   new PolicyStatement({
//     actions: ["es:ESHttp*"],
//     resources: [openSearchDomain.domainArn],
//   })
// );

// new appsync.CfnResolver(openSearchStack, "searchBlogResolver", {
//   typeName: "Query",
//   fieldName: "searchTodos2",
//   dataSourceName: "osDataSource",
//   apiId: "blt4v64u5bglplgxxo6vzzfnym",
//   runtime: {
//     name: "APPSYNC_JS",
//     runtimeVersion: "1.0.0",
//   },
//   code: `import { util } from '@aws-appsync/utils'
//   /**
//    * Searches for documents by using an input term
//    * @param {import('@aws-appsync/utils').Context} ctx the context
//    * @returns {*} the request
//    */
//   export function request(ctx) {
//     return {
//       operation: 'GET',
//       path: "/todo/_search",
//     }
//   }

//   /**
//    * Returns the fetched items
//    * @param {import('@aws-appsync/utils').Context} ctx the context
//    * @returns {*} the result
//    */
//   export function response(ctx) {
//     if (ctx.error) {
//       util.error(ctx.error.message, ctx.error.type)
//     }
//     return ctx.result.hits.hits.map((hit) => hit._source)
//   }
//   `,
// });

const osServiceRole = new iam.Role(openSearchStack, "OpenSearchServiceRole", {
  assumedBy: new iam.ServicePrincipal("appsync.amazonaws.com"),
  inlinePolicies: {
    openSearchAccessPolicy: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: [
            "es:ESHttpDelete",
            "es:ESHttpHead",
            "es:ESHttpGet",
            "es:ESHttpPost",
            "es:ESHttpPut",
          ],
          resources: [openSearchDomain.domainArn],
          effect: iam.Effect.ALLOW,
        }),
      ],
    }),
  },
});

openSearchDomain.addAccessPolicies(
  new iam.PolicyStatement({
    principals: [osServiceRole],
    actions: ["es:ESHttp*"],
    resources: [openSearchDomain.domainArn],
  })
);

// // throw new Error()
