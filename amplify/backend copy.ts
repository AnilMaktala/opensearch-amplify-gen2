import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { RemovalPolicy } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as appsync from "aws-cdk-lib/aws-appsync";
import { ConstructOrder } from "constructs";
import * as osis from "aws-cdk-lib/aws-osis";
import { Stack } from "aws-cdk-lib";
const backend = defineBackend({
  auth,
  data,
});
const dataStack = Stack.of(backend.data);

//const openSearchStack = dataStack.addDependency("OpenSearchStack");
const openSearchStack = backend.createStack("OpenSearchStack");
dataStack.addDependency(openSearchStack);

backend.data.resources.cfnResources.amplifyDynamoDbTables[
  "Todo"
].pointInTimeRecoveryEnabled = true;
backend.data.resources.cfnResources.amplifyDynamoDbTables[
  "Todo"
].streamSpecification = {
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

const api = backend.data.resources.graphqlApi;
const ds = api.addOpenSearchDataSource("ds", openSearchDomain);

// ds.createResolver("searchBlogResolver", {
//   typeName: "Query",
//   fieldName: "searchTodos",

//   requestMappingTemplate: appsync.MappingTemplate.fromString(
//     JSON.stringify({
//       version: "2017-02-28",
//       operation: "GET",
//       path: "/todo/_search",
//       params: {
//         headers: {},
//         queryString: {},
//         body: { from: 0, size: 50 },
//       },
//     })
//   ),
//   responseMappingTemplate: appsync.MappingTemplate.fromString(`[
//     #foreach($entry in $context.result.hits.hits)
//     #if( $velocityCount > 1 ) , #end
//     $utils.toJson($entry.get("_source"))
//     #end
//   ]`),
// });

// const s3BackupBucket = new s3.Bucket(
//   openSearchStack,
//   "OpenSearchBackupBucketAmplifyGen2",
//   {
//     blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
//     bucketName: "opensearch-backup-bucket-amplify-gen-2-test1",
//     enforceSSL: true,
//     versioned: true,
//     autoDeleteObjects: true,
//     removalPolicy: RemovalPolicy.DESTROY,
//   }
// );

// const openSearchIntegrationPipelineRole = new iam.Role(
//   openSearchStack,
//   "OpenSearchIntegrationPipelineRole",
//   {
//     assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com"),
//     inlinePolicies: {
//       openSearchPipelinePolicy: new iam.PolicyDocument({
//         statements: [
//           new iam.PolicyStatement({
//             actions: ["es:DescribeDomain"],
//             resources: [openSearchDomain.domainArn],
//             effect: iam.Effect.ALLOW,
//           }),
//           new iam.PolicyStatement({
//             actions: ["es:ESHttp*"],
//             resources: [openSearchDomain.domainArn],
//             effect: iam.Effect.ALLOW,
//           }),
//         ],
//       }),
//     },
//     managedPolicies: [
//       iam.ManagedPolicy.fromAwsManagedPolicyName(
//         "AmazonOpenSearchServiceFullAccess"
//       ),
//     ],
//   }
// );

// openSearchIntegrationPipelineRole.addManagedPolicy(
//   iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonDynamoDBFullAccess")
// );
// openSearchIntegrationPipelineRole.addManagedPolicy(
//   iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
// );

// const indexName = "todo";
// const indexMapping = {
//   settings: {
//     number_of_shards: 1,
//     number_of_replicas: 0,
//   },
//   mappings: {
//     properties: {
//       id: {
//         type: "keyword",
//       },
//       isDone: {
//         type: "boolean",
//       },
//       content: {
//         type: "text",
//       },
//     },
//   },
// };

// const openSearchTemplate = `
// version: "2"
// dynamodb-pipeline:
//   source:
//     dynamodb:
//       acknowledgments: true
//       tables:
//         - table_arn: "arn:aws:dynamodb:us-east-2:932080214319:table/Todo-aa5r5d5m3zhmdi7dhihtta2kr4-NONE"
//           # Remove the stream block if only export is needed
//           stream:
//             start_position: "LATEST"
//           # Remove the export block if only stream is needed
//           export:
//             s3_bucket: "${s3BackupBucket.bucketName}"
//             s3_region: "us-east-2"
//             s3_prefix: "Todo-aa5r5d5m3zhmdi7dhihtta2kr4-NONE/"
//       aws:
//         sts_role_arn: "${openSearchIntegrationPipelineRole.roleArn}"
//         region: "us-east-2"
//   sink:
//     - opensearch:
//         hosts:
//           [
//             "https://${openSearchDomain.domainEndpoint}",
//           ]
//         index: "${indexName}"
//         index_type: "custom"
//         template_content: |
//           ${JSON.stringify(indexMapping)}
//         document_id: '\${getMetadata("primary_key")}'
//         action: '\${getMetadata("opensearch_action")}'
//         document_version: '\${getMetadata("document_version")}'
//         document_version_type: "external"
//         bulk_size: 4
//         aws:
//           sts_role_arn: "${openSearchIntegrationPipelineRole.roleArn}"
//           region: "us-east-2"
//           `;

// const logGroup = new logs.LogGroup(openSearchStack, "LogGroup", {
//   logGroupName: "/aws/vendedlogs/OpenSearchService/pipelines/1",
//   removalPolicy: RemovalPolicy.DESTROY,
// });
// const cfnPipeline = new osis.CfnPipeline(
//   openSearchStack,
//   "OpenSearchIntegrationPipeline",
//   {
//     maxUnits: 4,
//     minUnits: 1,
//     pipelineConfigurationBody: openSearchTemplate,
//     pipelineName: "dynamodb-integration-2",
//     logPublishingOptions: {
//       isLoggingEnabled: true,
//       cloudWatchLogDestination: {
//         logGroup: logGroup.logGroupName,
//       },
//     },
//   }
// );

// const osDataSource = backend.data.addOpenSearchDataSource(
//   "osDataSource",
//   openSearchDomain
// );



new appsync.CfnResolver(dataStack, "searchBlogResolver", {
  typeName: "Query",
  fieldName: "searchTodos2",
  dataSourceName: "ds",
  apiId: backend.data.apiId,
  runtime: {
    name: "APPSYNC_JS",
    runtimeVersion: "1.0.0",
  },
  code: `import { util } from '@aws-appsync/utils'
  /**
   * Searches for documents by using an input term
   * @param {import('@aws-appsync/utils').Context} ctx the context
   * @returns {*} the request
   */
  export function request(ctx) {
    return {
      operation: 'GET',
      path: "/todo/_search",
    }
  }

  /**
   * Returns the fetched items
   * @param {import('@aws-appsync/utils').Context} ctx the context
   * @returns {*} the result
   */
  export function response(ctx) {
    if (ctx.error) {
      util.error(ctx.error.message, ctx.error.type)
    }
    return ctx.result.hits.hits.map((hit) => hit._source)
  }
  `,
});

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
