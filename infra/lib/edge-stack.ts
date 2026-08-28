import { Stack, type StackProps, RemovalPolicy, Duration, CfnOutput } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { Bucket, BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import {
  Distribution,
  ViewerProtocolPolicy,
  CachePolicy,
  ResponseHeadersPolicy,
  HeadersFrameOption,
  SecurityPolicyProtocol
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import { HostedZone, ARecord, RecordTarget, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { makeWebAcl } from "./waf.js";
import type { PlatformConfig } from "./config.js";

export interface EdgeStackProps extends StackProps {
  config: PlatformConfig;
}

export class EdgeStack extends Stack {
  public readonly widgetBucket: Bucket;
  public readonly chatBucket: Bucket;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { config } = props;

    const zone = config.hostedZoneId
      ? HostedZone.fromHostedZoneAttributes(this, "Zone", {
          hostedZoneId: config.hostedZoneId,
          zoneName: config.domainName
        })
      : HostedZone.fromLookup(this, "Zone", { domainName: config.domainName });

    this.widgetBucket = this.privateBucket("WidgetBucket");
    this.chatBucket = this.privateBucket("ChatBucket");

    const cdnWaf = makeWebAcl(this, "CdnWaf", "CLOUDFRONT", config.env);

    const securityHeaders = new ResponseHeadersPolicy(this, "SecHeaders", {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true
        },
        referrerPolicy: {
          referrerPolicy: "strict-origin-when-cross-origin" as never,
          override: true
        }
      }
    });

    this.makeDistribution(
      "CdnDistribution",
      zone,
      config.subdomains.cdn,
      this.widgetBucket,
      securityHeaders,
      cdnWaf.attrArn
    );
    this.makeDistribution(
      "ChatDistribution",
      zone,
      config.subdomains.chat,
      this.chatBucket,
      securityHeaders,
      cdnWaf.attrArn
    );

    new CfnOutput(this, "WidgetBucketName", { value: this.widgetBucket.bucketName });
    new CfnOutput(this, "ChatBucketName", { value: this.chatBucket.bucketName });
  }

  private privateBucket(id: string): Bucket {
    return new Bucket(this, id, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false
    });
  }

  private makeDistribution(
    id: string,
    zone: IHostedZone,
    domain: string,
    bucket: Bucket,
    responseHeadersPolicy: ResponseHeadersPolicy,
    webAclId: string
  ): Distribution {
    const cert = new Certificate(this, `${id}Cert`, {
      domainName: domain,
      validation: CertificateValidation.fromDns(zone),
      // CloudFront requires certs in us-east-1; stack should be deployed there.
    });

    const dist = new Distribution(this, id, {
      domainNames: [domain],
      certificate: cert,
      webAclId,
      defaultRootObject: id === "ChatDistribution" ? "chat.html" : "widget.js",
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy,
        compress: true
      }
    });

    new ARecord(this, `${id}Alias`, {
      zone,
      recordName: domain,
      target: RecordTarget.fromAlias(new CloudFrontTarget(dist))
    });

    return dist;
  }
}
