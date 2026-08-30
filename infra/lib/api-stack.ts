import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import type { Construct } from "constructs";
import {
  HttpApi,
  HttpMethod,
  DomainName,
  CfnStage
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
import {
  UserPool,
  UserPoolClient,
  AccountRecovery
} from "aws-cdk-lib/aws-cognito";
import {
  HttpJwtAuthorizer
} from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { RemovalPolicy } from "aws-cdk-lib";
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
      apiName: `chatbot-platform-api-${config.env}`,
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
      alias: `chatbot-platform-${config.env}-widget-jwt`
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
        // GetItem/PutItem for the session item; Query for reading KB titles to
        // seed the widget's suggested prompts — all bounded to TENANT# by
        // LeadingKeys (tenant derived server-side from the verified site key).
        actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"],
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

    // Create the model-API-key secret SHELL. On first create, CloudFormation
    // seeds it with a random placeholder value (Secrets Manager rejects a truly
    // empty secret) — you overwrite it once with the real key via
    // `aws secretsmanager put-secret-value`. Crucially, we pass NO explicit
    // value: the key material is never in code or the CloudFormation template,
    // and generation only happens at create-time, so redeploys NEVER overwrite
    // the value you set. RETAIN in prod so a stack teardown can't drop a live
    // key.
    const modelKeySecret = new Secret(this, "ModelApiKeySecret", {
      secretName: `chatbot-platform-${config.env}/model-api-key`,
      description:
        "Model provider API key (e.g. Anthropic). Populate manually via put-secret-value.",
      removalPolicy:
        config.env === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    this.chatFn = nodeHandler(this, "ChatFn", {
      handlerFile: "chat.ts",
      memorySize: 1024,
      environment: {
        ENV: config.env,
        TABLE_NAME: table.tableName,
        JWT_KMS_KEY_ID: jwtKey.keyId,
        MODEL_API_KEY_SECRET_ARN: modelKeySecret.secretArn,
        // The chat POST comes from inside the chat iframe (this surface); the
        // handler requires the request Origin to be this chat origin.
        CHAT_ORIGIN: config.subdomains.chat,
        // Only needed for a workspace-scoped (identity-linked) Anthropic key;
        // set the ANTHROPIC_WORKSPACE_ID deploy env to pass it through. Not a
        // secret — it's just a workspace identifier. Empty string when unset.
        ANTHROPIC_WORKSPACE_ID: process.env.ANTHROPIC_WORKSPACE_ID ?? ""
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

    // --- Portal auth (Cognito) + admin routes ---
    const postConfirm = nodeHandler(this, "PostConfirmFn", {
      handlerFile: "post-confirmation.ts",
      environment: { ENV: config.env, TABLE_NAME: table.tableName }
    });
    postConfirm.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        resources: [table.tableArn],
        conditions: {
          "ForAllValues:StringLike": {
            "dynamodb:LeadingKeys": ["USER#*", "TENANT#*"]
          }
        }
      })
    );

    const userPool = new UserPool(this, "UserPool", {
      userPoolName: `chatbot-platform-${config.env}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      standardAttributes: { email: { required: true, mutable: false } },
      lambdaTriggers: { postConfirmation: postConfirm },
      removalPolicy:
        config.env === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });
    const userPoolClient = new UserPoolClient(this, "UserPoolClient", {
      userPool,
      authFlows: { userSrp: true }
    });

    const authorizer = new HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] }
    );

    const admin = nodeHandler(this, "AdminFn", {
      handlerFile: "admin.ts",
      environment: {
        ENV: config.env,
        TABLE_NAME: table.tableName,
        CDN_ORIGIN: config.subdomains.cdn,
        CHAT_ORIGIN: config.subdomains.chat,
        API_ORIGIN: config.subdomains.api,
        // The tenant portal (a different subdomain) calls the admin API
        // cross-origin, so the handler reflects this exact origin in CORS.
        PORTAL_ORIGIN: config.subdomains.app
      }
    });
    // Admin operations span USER# (profile lookup) and TENANT# (config, KB,
    // sessions, key issuance) partitions; tenant is derived server-side from
    // the Cognito sub, never from the request body.
    admin.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ],
        resources: [table.tableArn],
        conditions: {
          "ForAllValues:StringLike": {
            "dynamodb:LeadingKeys": ["USER#*", "TENANT#*"]
          }
        }
      })
    );

    this.httpApi.addRoutes({
      path: "/v1/admin/{proxy+}",
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration("AdminIntegration", admin),
      authorizer
    });
    // CORS preflight for the admin routes MUST be unauthenticated — the browser
    // sends OPTIONS without the Authorization header, so it can't carry the JWT
    // the authorizer requires. A separate OPTIONS route (no authorizer) lets the
    // handler answer the preflight with the right CORS headers.
    this.httpApi.addRoutes({
      path: "/v1/admin/{proxy+}",
      methods: [HttpMethod.OPTIONS],
      integration: new HttpLambdaIntegration("AdminOptionsIntegration", admin)
    });

    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId
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

    // Note: WAFv2 cannot attach to an HTTP API (API Gateway v2) — it only
    // supports REST APIs, CloudFront, ALB, etc. Edge protection for this API
    // is provided by stage-level throttling (below) plus the per-session and
    // per-tenant DDB rate limits in the chat handler. The CloudFront WAF still
    // guards the widget/chat/marketing/portal surfaces in the Edge stack.
    const defaultStage = this.httpApi.defaultStage?.node
      .defaultChild as CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingBurstLimit: 200,
      throttlingRateLimit: 100
    };

    new CfnOutput(this, "ApiOrigin", {
      value: `https://${config.subdomains.api}`
    });
  }
}
