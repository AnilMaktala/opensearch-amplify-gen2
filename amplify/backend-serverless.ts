import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as oss from "aws-cdk-lib/aws-opensearchserverless";

import { Stack } from "aws-cdk-lib";
import { storage } from "./storage/resource";

import * as osis from "aws-cdk-lib/aws-osis";
import * as iam from "aws-cdk-lib/aws-iam";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib";
// Define backend resources
const backend = defineBackend({
  auth,
  data,
  storage,
});

// Get the data stack
const openSearchStack = Stack.of(backend.data);

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

// Create VPC for OpenSearchServerless
const vpc = new ec2.Vpc(openSearchStack, "OpenSearchServerlessVpc", {
  vpcName: "dynamodb-opensearch-etl-vpc",
  ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
  maxAzs: 3,
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: "private-oss-pipeline-",
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    },
  ],
});

// Create security group
const securityGroup = new ec2.SecurityGroup(
  openSearchStack,
  "OpenSearchServerlessSecurityGroup",
  {
    vpc: vpc,
  }
);

// Allow HTTPS ingress from the VPC CIDR
securityGroup.addIngressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(443)
);

// Allow HTTP ingress from the VPC CIDR
securityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80));

// Create Opensearch servelrless collection
const OpenSearchServerlessCollection = new oss.CfnCollection(
  openSearchStack,
  "OpenSearchServerlessCollection",
  {
    name: "dynamodb-etl-collection",
    description:
      "Collection created by CDK to explore DynamoDB to OpenSearch Pipeline ETL Integration.",
    type: "SEARCH",
  }
);

const s3BucketArn = backend.storage.resources.bucket.bucketArn;
const s3BucketName = backend.storage.resources.bucket.bucketName;

// Create CloudWatch logs for Ingestion Pipeline
const ingestionLogGroup = new cdk.aws_logs.LogGroup(
  openSearchStack,
  "IngestionPipelineLogGroup",
  {
    logGroupName: "IngestionPipelineLogGroup",
    removalPolicy: RemovalPolicy.DESTROY,
    retention: cdk.aws_logs.RetentionDays.ONE_DAY,
  }
);

// Create OpenSearch Ingestion Pipeline Role
const pipelineRole = new iam.Role(openSearchStack, "IngestionRole", {
  assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com"),
});

// Create an IAM role for custom resource
const dynamoDbPipelineCustomResourceRole = new cdk.aws_iam.Role(
  openSearchStack,
  "DynamoDbPipelineCustomResourceRole",
  {
    assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
  }
);

// Add policy to it to allow write, create, delete and update backups on our dynamodb
dynamoDbPipelineCustomResourceRole.addToPolicy(
  new cdk.aws_iam.PolicyStatement({
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "dynamodb:BatchWriteItem",
      "dynamodb:CreateTable",
      "dynamodb:DeleteTable",
      "dynamodb:UpdateContinuousBackups",
    ],
    conditions: {
      StringEquals: {
        "dynamodb:TableName": "Todo",
      },
    },
    resources: ["*"],
  })
);

// Add policy to it to allow pipeline create and delete
dynamoDbPipelineCustomResourceRole.addToPolicy(
  new cdk.aws_iam.PolicyStatement({
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "osis:CreatePipeline",
      "osis:DeletePipeline",
      "osis:StopPipeline",
    ],
    resources: ["*"],
  })
);

// Add policy to it to allow create and modify IAM roles on pipelineRole
dynamoDbPipelineCustomResourceRole.addToPolicy(
  new cdk.aws_iam.PolicyStatement({
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "iam:PassRole",
      "iam:CreateRole",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:GetRole",
      "iam:DeleteRole",
    ],
    resources: [`${pipelineRole.roleArn}`],
  })
);

// Add policy to allow list policies to delete created policies
// on delete event
dynamoDbPipelineCustomResourceRole.addToPolicy(
  new cdk.aws_iam.PolicyStatement({
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: ["iam:ListPolicies"],
    resources: ["*"],
  })
);

// Add policy to it to allow create policy for OpenSearch Ingestion Pipeline Role
dynamoDbPipelineCustomResourceRole.addToPolicy(
  new cdk.aws_iam.PolicyStatement({
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: ["iam:CreatePolicy", "iam:DeletePolicy"],
    conditions: {
      StringEquals: {
        "iam:PolicyName": [
          "IngestionPipelinePolicy",
          "DynamoDBIngestionPolicy",
        ],
      },
    },
    resources: ["*"],
  })
);

// Add policy to it to allow CloudWatch Logs creation
dynamoDbPipelineCustomResourceRole.addToPolicy(
  new cdk.aws_iam.PolicyStatement({
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "logs:CreateLogDelivery",
      "logs:PutResourcePolicy",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:DescribeResourcePolicies",
      "logs:GetLogDelivery",
      "logs:ListLogDeliveries",
    ],
    resources: ["*"],
  })
);

// Add policy to allow deletion of s3 bucket
dynamoDbPipelineCustomResourceRole.addToPolicy(
  new cdk.aws_iam.PolicyStatement({
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "s3:ListObjects",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:ListBucket",
      "s3:DeleteBucket",
    ],
    resources: [`${s3BucketArn}`, `${s3BucketArn}/*`],
  })
);

// Add poliucy to allow creation and deletion of OpenSearchServerless VPC Enpoint,
// as well as updating Network Policy
dynamoDbPipelineCustomResourceRole.addToPolicy(
  new cdk.aws_iam.PolicyStatement({
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "aoss:APIAccessAll",
      "aoss:CreateVpcEndpoint",
      "aoss:DeleteVpcEndpoint",
      "aoss:ListVpcEndpoints",
      "aoss:GetSecurityPolicy",
      "aoss:UpdateSecurityPolicy",
      "ec2:CreateVpcEndpoint",
      "ec2:DeleteVpcEndpoints",
      "ec2:ListVpcEndpoints",
      "ec2:DescribeVpcEndpoints",
      "ec2:DescribeVpcs",
      "ec2:DescribeSubnets",
      "ec2:DescribeSecurityGroups",
      "ec2:CreateTags",
      "ec2:DeleteTags",
      "route53:AssociateVPCWithHostedZone",
      "route53:DisassociateVPCFromHostedZone",
    ],
    resources: ["*"],
  })
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
              OpenSearchServerlessCollection.attrArn,
              OpenSearchServerlessCollection.attrArn + "/*",
            ],
            effect: iam.Effect.ALLOW,
          }),
          new iam.PolicyStatement({
            actions: [
              "*",
              "es:ESHttp*",
              "aoss:BatchGetCollection",
              "aoss:APIAccessAll",
            ],
            resources: [
              OpenSearchServerlessCollection.attrArn,
              OpenSearchServerlessCollection.attrArn + "/*",
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
            resources: [s3BucketArn, s3BucketArn + "/*"],
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
            resources: [tableArn, tableArn + "/*"],
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

const collectionName = "dynamodb-etl-collection";
// Opensearch encryption policy
const encryptionPolicy = new oss.CfnSecurityPolicy(
  openSearchStack,
  "EncryptionPolicy",
  {
    name: "ddb-etl-encryption-policy",
    type: "encryption",
    description: `Encryption policy for ${collectionName} collection.`,
    policy: `
      {
        "Rules": [
          {
            "ResourceType": "collection",
            "Resource": ["collection/${collectionName}*"]
          }
        ],
        "AWSOwnedKey": true
      }
      `,
  }
);

// Opensearch network policy
const networkPolicy = new oss.CfnSecurityPolicy(
  openSearchStack,
  "NetworkPolicy",
  {
    name: "ddb-etl-network-policy",
    type: "network",
    description: `Network policy for ${collectionName} collection.`,
    policy: `
        [
          {
            "Rules": [
              {
                "ResourceType": "collection",
                "Resource": ["collection/${collectionName}"]
              },
              {
                "ResourceType": "dashboard",
                "Resource": ["collection/${collectionName}"]
              }
            ],
            "AllowFromPublic": true
          }
        ]
      `,
  }
);
// Opensearch data access policy
const dataAccessPolicy = new oss.CfnAccessPolicy(
  openSearchStack,
  "DataAccessPolicy",
  {
    name: "ddb-etl-access-policy",
    type: "data",
    description: `Data access policy for ${collectionName} collection.`,
    policy: `
        [
          {
            "Rules": [
              {
                "ResourceType": "collection",
                "Resource": ["collection/${collectionName}*"],
                "Permission": [
                  "aoss:*",
                  "aoss:DescribeCollectionItems",
                  "aoss:DeleteCollectionItems",
                  "aoss:UpdateCollectionItems"
                ]
              },
              {
                "ResourceType": "index",
                "Resource": ["index/${collectionName}*/*"],
                "Permission": [
                  "aoss:*",
                  "aoss:DeleteIndex",
                  "aoss:UpdateIndex",
                  "aoss:DescribeIndex",
                  "aoss:ReadDocument",
                  "aoss:WriteDocument"
                ]
              }
            ],
            "Principal": [
              
              "${pipelineRole.roleArn}",
              "arn:aws:sts::590184051493:assumed-role/amplify-opensearchamplify-OpenSearchIntegrationPipe-o8fDGuMS6wG5/OpenSearch-serverless2b91c3e4-87c1-4fb1-9061-ff1e368d0fe6",
              "arn:aws:iam::590184051493:user/Admin"
            ]
          }
        ]
      `,
  }
);

OpenSearchServerlessCollection.node.addDependency(encryptionPolicy);
OpenSearchServerlessCollection.node.addDependency(networkPolicy);
OpenSearchServerlessCollection.node.addDependency(dataAccessPolicy);

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
      priority: {
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
        sts_role_arn: "${openSearchIntegrationPipelineRole.roleArn}"
        region: "${region}"
  sink:
    - opensearch:
        hosts:
          ["https://c0y2tgas7sy71rsz5yjl.us-east-1.aoss.amazonaws.com"]
        index: "${indexName}"
        index_type: "custom"
        template_content: |
          ${JSON.stringify(indexMapping)}
        aws:
          sts_role_arn: "${openSearchIntegrationPipelineRole.roleArn}"
          region: "${region}"
          serverless: true
          serverless_options:
            network_policy_name: "${networkPolicy.name}"
`;

// Create a CloudWatch log group
const logGroup = new LogGroup(openSearchStack, "LogGroup", {
  logGroupName: "/aws/vendedlogs/OpenSearchService/pipelines/1",
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

//Add OpenSearch data source
const osDataSource = backend.data.addHttpDataSource(
  "osDataSource",
  OpenSearchServerlessCollection.attrCollectionEndpoint
);
