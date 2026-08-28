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
import { nodeHandler } from "./lambda.js";
import type { PlatformConfig } from "./config.js";

export interface ApiStackProps extends StackProps {
  config: PlatformConfig;
  table: Table;
}

export class ApiStack extends Stack {
  public readonly httpApi: HttpApi;

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

    new CfnOutput(this, "ApiUrl", {
      value: `https://${config.subdomains.api}`
    });
  }
}
