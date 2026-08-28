import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import type { Construct } from "constructs";
import {
  HttpApi,
  HttpMethod,
  DomainName
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  Certificate,
  CertificateValidation
} from "aws-cdk-lib/aws-certificatemanager";
import { HostedZone, ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayv2DomainProperties } from "aws-cdk-lib/aws-route53-targets";
import type { Table } from "aws-cdk-lib/aws-dynamodb";
import { Key, KeySpec, KeyUsage } from "aws-cdk-lib/aws-kms";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { makeWebAcl } from "./waf.js";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { nodeHandler } from "./lambda.js";
import { tenantPk } from "@platform/shared";
import type { PlatformConfig } from "./config.js";

export interface ApiStackProps extends StackProps {
  config: PlatformConfig;
  table: Table;
}

export class ApiStack extends Stack {
  public readonly httpApi: HttpApi;
  public readonly chatFn: NodejsFunction;
  public readonly sessionFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, table } = props;

    const zone = config.hostedZoneId
      ? HostedZone.fromHostedZoneAttributes(this, "Zone", {
          hostedZoneId: config.hostedZoneId,
          zoneName: config.domainName
        })
      : HostedZone.fromLookup(this, "Zone", {
          domainName: config.domainName
        });

    const cert = new Certificate(this, "ApiCert", {
      domainName: config.subdomains.api,
      validation: CertificateValidation.fromDns(zone)
    });

    const domain = new DomainName(this, "ApiDomain", {
      domainName: config.subdomains.api,
      certificate: cert
    });

    this.httpApi = new HttpApi(this, "HttpApi", {
      apiName: `platform-api-${config.env}`,
      defaultDomainMapping: { domainName: domain }
    });

    const health = nodeHandler(this, "HealthFn", {
      handlerFile: "health.ts",
      environment: {
        ENV: config.env,
        TABLE_NAME: table.tableName,
        APP_VERSION: process.env.APP_VERSION ?? "dev"
      }
    });

    this.httpApi.addRoutes({
      path: "/health",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("HealthIntegration", health)
    });

    const jwtKey = new Key(this, "WidgetJwtKey", {
      keySpec: KeySpec.ECC_NIST_P256,
      keyUsage: KeyUsage.SIGN_VERIFY,
      alias: `platform-${config.env}-widget-jwt`
    });

    this.sessionFn = nodeHandler(this, "SessionFn", {
      handlerFile: "session.ts",
      environment: {
        ENV: config.env,
        TABLE_NAME: table.tableName,
        JWT_KMS_KEY_ID: jwtKey.keyId
      }
    });

    // Base-table item access is restricted to TENANT#-prefixed partitions.
    // This bounds the shared handler to tenant data (not a per-tenant guard —
    // cross-tenant isolation is enforced in app code via the site-key GSI
    // lookup that derives tenantId server-side). Per-tenant IAM would require
    // request-scoped credentials (revisit in a later phase).
    this.sessionFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        resources: [table.tableArn],
        conditions: {
          "ForAllValues:StringLike": {
            "dynamodb:LeadingKeys": [`${tenantPk("*")}`]
          }
        }
      })
    );
    this.sessionFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [`${table.tableArn}/index/GSI1`]
      })
    );
    jwtKey.grant(this.sessionFn, "kms:Sign");

    this.httpApi.addRoutes({
      path: "/v1/widget/session",
      methods: [HttpMethod.POST, HttpMethod.OPTIONS],
      integration: new HttpLambdaIntegration("SessionIntegration", this.sessionFn)
    });

    // MODEL_API_KEY is supplied at deploy time via secret material — never in
    // code or CloudFormation template. Import by name; CDK grants read only.
    const modelKeySecret = Secret.fromSecretNameV2(
      this,
      "ModelApiKeySecret",
      `platform-${config.env}/model-api-key`
    );

    this.chatFn = nodeHandler(this, "ChatFn", {
      handlerFile: "chat.ts",
      memorySize: 1024,
      environment: {
        ENV: config.env,
        TABLE_NAME: table.tableName,
        JWT_KMS_KEY_ID: jwtKey.keyId,
        MODEL_API_KEY_SECRET_ARN: modelKeySecret.secretArn
      }
    });

    // All chat data lives under TENANT#-prefixed partitions: config/products/
    // usage at TENANT#<id>, and message history at TENANT#<id>#SESSION#<sid>.
    // The LeadingKeys condition therefore bounds the handler to tenant
    // partitions; app code binds session→tenant from the JWT claims.
    this.chatFn.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:BatchWriteItem",
          "dynamodb:UpdateItem"
        ],
        resources: [table.tableArn],
        conditions: {
          "ForAllValues:StringLike": {
            "dynamodb:LeadingKeys": ["TENANT#*"]
          }
        }
      })
    );
    jwtKey.grant(this.chatFn, "kms:GetPublicKey");
    modelKeySecret.grantRead(this.chatFn);

    this.httpApi.addRoutes({
      path: "/v1/chat/message",
      methods: [HttpMethod.POST, HttpMethod.OPTIONS],
      integration: new HttpLambdaIntegration("ChatIntegration", this.chatFn)
    });

    new ARecord(this, "ApiAliasRecord", {
      zone,
      recordName: config.subdomains.api,
      target: RecordTarget.fromAlias(
        new ApiGatewayv2DomainProperties(
          domain.regionalDomainName,
          domain.regionalHostedZoneId
        )
      )
    });

    const webAcl = makeWebAcl(this, "ApiWaf", "REGIONAL", config.env);
    const stageArn =
      `arn:aws:apigateway:${this.region}::/apis/` +
      `${this.httpApi.apiId}/stages/$default`;
    new CfnWebACLAssociation(this, "ApiWafAssoc", {
      resourceArn: stageArn,
      webAclArn: webAcl.attrArn
    });

    new CfnOutput(this, "ApiUrl", {
      value: `https://${config.subdomains.api}`
    });
  }
}
