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
import { ConstructOrder } from "constructs";

const backend = defineBackend({
  auth,
  data,
});
const openSearchStack = backend.createStack("OpenSearchStack");

// Enable PITR (required for zero-ETL integration)
const todoTable =
  backend.data.resources.cfnResources.amplifyDynamoDbTables["Todo"];
todoTable.pointInTimeRecoveryEnabled = true;
todoTable.streamSpecification = {
  streamViewType: dynamodb.StreamViewType.NEW_IMAGE,
};

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
            resources: ["*"],
            effect: iam.Effect.ALLOW,
          }),
          new iam.PolicyStatement({
            actions: ["es:ESHttp*", "es:ESHttpPost"],
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
              "arn:aws:s3:::opensearch-backup-bucket-amplify-gen-2-test1",
              "arn:aws:s3:::opensearch-backup-bucket-amplify-gen-2-test1/*",
              "arn:aws:s3:::amplify-opensearchamplify-amplifydataamplifycodege-bgdz2xm2suul",
              "arn:aws:s3:::amplify-opensearchamplify-amplifydataamplifycodege-bgdz2xm2suul/*",
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
              "arn:aws:dynamodb:us-east-2:932080214319:table/Todo-tbadv7vxszgclbymvtl2vdjwmi-NONE/*",
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

// openSearchIntegrationPipelineRole.addManagedPolicy(
//   iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonDynamoDBFullAccess")
// );
// openSearchIntegrationPipelineRole.addManagedPolicy(
//   iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
// );

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

const indexName_second = "todo1";
const indexMapping_second = {
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
        - table_arn: "arn:aws:dynamodb:us-east-2:932080214319:table/Todo-tbadv7vxszgclbymvtl2vdjwmi-NONE"
          # Remove the stream block if only export is needed
          stream:
            start_position: "LATEST"
          # Remove the export block if only stream is needed
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
    - opensearch:
        hosts:
          [
            "https://${openSearchDomain.domainEndpoint}",
          ]
        index: "${indexName_second}"
        index_type: "custom"
        template_content: |
          ${JSON.stringify(indexMapping_second)}
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
    pipelineName: "dynamodb-integration-3",
    logPublishingOptions: {
      isLoggingEnabled: true,
      cloudWatchLogDestination: {
        logGroup: logGroup.logGroupName,
      },
    },
  }
);

const osDataSource = backend.data.addOpenSearchDataSource(
  "osDataSource",
  openSearchDomain
);
// new appsync.CfnResolver(openSearchStack, "searchBlogResolver", {
//   typeName: "Query",
//   fieldName: "searchTodos1",
//   dataSourceName: "OpenSearchDataSource",
//   apiId: backend.data.apiId,
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

// const osServiceRole = new iam.Role(openSearchStack, "OpenSearchServiceRole", {
//   assumedBy: new iam.ServicePrincipal("appsync.amazonaws.com"),
//   inlinePolicies: {
//     openSearchAccessPolicy: new iam.PolicyDocument({
//       statements: [
//         new iam.PolicyStatement({
//           actions: [
//             "es:ESHttpDelete",
//             "es:ESHttpHead",
//             "es:ESHttpGet",
//             "es:ESHttpPost",
//             "es:ESHttpPut",
//           ],
//           resources: [openSearchDomain.domainArn],
//           effect: iam.Effect.ALLOW,
//         }),
//       ],
//     }),
//   },
// });

// openSearchDomain.addAccessPolicies(
//   new iam.PolicyStatement({
//     principals: [osServiceRole],
//     actions: ["es:ESHttp*"],
//     resources: [openSearchDomain.domainArn],
//   })
// );

// console.log(backend.data.node.children)
// const searchableStack = backend.data.node.findChild("SearchableStack")
// // console.log(searchableStack.node.findChild("SearchableStack").node.children.map(child => child.node.id))
// console.log(searchableStack.node.children.map(child => child.node.id))
// searchableStack.node.tryRemoveChild("OpenSearchDomain")
// searchableStack.node.tryRemoveChild("OpenSearchAccessIAMRole")
// searchableStack.node.tryRemoveChild("OpenSearchStreamingLambdaIAMRole")
// searchableStack.node.tryRemoveChild("CloudwatchLogsAccess")
// searchableStack.node.tryRemoveChild("LambdaLayerVersion")
// searchableStack.node.tryRemoveChild("OpenSearchStreamingLambdaFunction")
// searchableStack.node.tryRemoveChild("LayerResourceMapping")
// searchableStack.node.tryRemoveChild("HasEnvironmentParameter")
// console.log(searchableStack.node.children.map(child => child.node.id))
// // console.log("Successful delete: " + backend.data.node.tryRemoveChild("SearchableStack"))
// const nestedStack = backend.data.node.findChild("SearchableStack.NestedStack")
// console.log(nestedStack.node.children[0])
// // console.log("Successful delete: " + backend.data.node.tryRemoveChild("SearchableStack.NestedStack"))
// console.log(backend.data.node.children.map(child => child.node.id))

// // console.log(backend.data.node.findChild("SearchableStack"))

// backend.data.node.tryRemoveChild(/* "Remove opensearch domain, lambdas etc." */)
// console.log(backend.data.resources.cfnResources.cfnDataSources)

// backend.data.resources.cfnResources.cfnDataSources["OpenSearchDataSource"].elasticsearchConfig = undefined
// backend.data.resources.cfnResources.cfnDataSources["OpenSearchDataSource"].openSearchServiceConfig = {
//   awsRegion: "us-east-1",
//   endpoint: "https://" + openSearchDomain.domainEndpoint,
// }

// backend.data
//   .resources
//   .cfnResources
//   .cfnDataSources["OpenSearchDataSource"]
//   .serviceRoleArn = osServiceRole.roleArn

// // throw new Error()
