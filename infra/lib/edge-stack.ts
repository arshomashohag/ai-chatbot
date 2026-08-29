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
  public readonly marketingBucket: Bucket;
  public readonly portalBucket: Bucket;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { config } = props;

    const zone = config.hostedZoneId
      ? HostedZone.fromHostedZoneAttributes(this, "Zone", {
          hostedZoneId: config.hostedZoneId,
          zoneName: config.domainName
        })
      : HostedZone.fromLookup(this, "Zone", { domainName: config.domainName });

    this.widgetBucket = this.privateBucket("WidgetBucket", config.env, "widget");
    this.chatBucket = this.privateBucket("ChatBucket", config.env, "chat");

    const cdnWaf = makeWebAcl(this, "CdnWaf", "CLOUDFRONT", config.env);

    // Per-surface CSP. Built from config.subdomains so it stays env-independent
    // (no hardcoded origins). script-src is never 'unsafe-inline'; 'unsafe-inline'
    // is limited to style-src because MUI/emotion and the static HTML inject
    // runtime <style> and nonces aren't practical for pre-built static assets.
    const api = `https://${config.subdomains.api}`;
    const cdn = `https://${config.subdomains.cdn}`;
    const chat = `https://${config.subdomains.chat}`;
    const fontsCss = "https://fonts.googleapis.com";
    const fontsFiles = "https://fonts.gstatic.com";
    const cognito = `https://cognito-idp.${config.region}.amazonaws.com`;
    const base = "default-src 'none'; object-src 'none'; base-uri 'none'";

    const cdnCsp = `${base}; script-src 'self'; frame-ancestors 'none'`;
    // The chat surface is DESIGNED to be framed by the widget on any tenant site
    // — so frame-ancestors *, and NO X-Frame-Options (DENY would break it).
    const chatCsp =
      `${base}; script-src 'self'; style-src 'self' 'unsafe-inline' ${fontsCss}; ` +
      `font-src ${fontsFiles}; connect-src 'self' ${api}; img-src 'self' data:; ` +
      `frame-ancestors *`;
    const marketingCsp =
      `${base}; script-src 'self' ${cdn}; style-src 'self' 'unsafe-inline' ${fontsCss}; ` +
      `font-src ${fontsFiles}; connect-src 'self' ${api}; frame-src ${chat}; ` +
      `img-src 'self' data:; frame-ancestors 'none'`;
    const portalCsp =
      `${base}; script-src 'self'; style-src 'self' 'unsafe-inline' ${fontsCss}; ` +
      `font-src ${fontsFiles}; connect-src 'self' ${api} ${cognito}; ` +
      `img-src 'self' data:; frame-ancestors 'none'`;

    this.marketingBucket = this.privateBucket(
      "MarketingBucket",
      config.env,
      "marketing"
    );
    this.portalBucket = this.privateBucket("PortalBucket", config.env, "portal");

    const cdnDist = this.makeDistribution({
      id: "CdnDistribution",
      zone,
      domain: config.subdomains.cdn,
      bucket: this.widgetBucket,
      // publicCors=true: widget.js is loaded cross-origin by every tenant site.
      responseHeadersPolicy: this.makeSecurityHeaders("CdnSec", cdnCsp, false, true),
      webAclId: cdnWaf.attrArn,
      rootObject: "widget.js"
    });
    const chatDist = this.makeDistribution({
      id: "ChatDistribution",
      zone,
      domain: config.subdomains.chat,
      bucket: this.chatBucket,
      // framable=true → no X-Frame-Options; framing controlled by CSP.
      // publicCors=true: the chat surface + its assets are loaded cross-origin.
      responseHeadersPolicy: this.makeSecurityHeaders("ChatSec", chatCsp, true, true),
      webAclId: cdnWaf.attrArn,
      rootObject: "chat.html"
    });
    const marketingDist = this.makeDistribution({
      id: "MarketingDistribution",
      zone,
      domain: config.subdomains.site,
      bucket: this.marketingBucket,
      responseHeadersPolicy: this.makeSecurityHeaders(
        "MarketingSec",
        marketingCsp,
        false
      ),
      webAclId: cdnWaf.attrArn,
      rootObject: "index.html",
      spa: true
    });
    const portalDist = this.makeDistribution({
      id: "PortalDistribution",
      zone,
      domain: config.subdomains.app,
      bucket: this.portalBucket,
      responseHeadersPolicy: this.makeSecurityHeaders(
        "PortalSec",
        portalCsp,
        false
      ),
      webAclId: cdnWaf.attrArn,
      rootObject: "index.html",
      spa: true
    });

    new CfnOutput(this, "WidgetBucketName", { value: this.widgetBucket.bucketName });
    new CfnOutput(this, "ChatBucketName", { value: this.chatBucket.bucketName });
    new CfnOutput(this, "MarketingBucketName", { value: this.marketingBucket.bucketName });
    new CfnOutput(this, "PortalBucketName", { value: this.portalBucket.bucketName });

    // Distribution ids — the deploy pipeline invalidates these after syncing
    // new assets so CloudFront serves fresh content instead of cached copies.
    new CfnOutput(this, "CdnDistributionId", { value: cdnDist.distributionId });
    new CfnOutput(this, "ChatDistributionId", { value: chatDist.distributionId });
    new CfnOutput(this, "MarketingDistributionId", {
      value: marketingDist.distributionId
    });
    new CfnOutput(this, "PortalDistributionId", {
      value: portalDist.distributionId
    });

    // Public origins — the single source of truth for frontend builds. The
    // deploy pipeline reads these instead of re-deriving subdomain strings.
    new CfnOutput(this, "CdnOrigin", { value: `https://${config.subdomains.cdn}` });
    new CfnOutput(this, "ChatOrigin", { value: `https://${config.subdomains.chat}` });
    new CfnOutput(this, "SiteOrigin", { value: `https://${config.subdomains.site}` });
    new CfnOutput(this, "PortalOrigin", { value: `https://${config.subdomains.app}` });
  }

  private privateBucket(id: string, env: string, role: string): Bucket {
    return new Bucket(this, id, {
      // Explicit, predictable name (globally unique via the account id) so the
      // deploy role's asset-sync IAM can target it and the sync command is
      // deterministic: platform-<env>-<role>-<account>.
      bucketName: `chatbot-platform-${env}-${role}-${this.account}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false
    });
  }

  private makeSecurityHeaders(
    id: string,
    csp: string,
    framable: boolean,
    publicCors = false
  ): ResponseHeadersPolicy {
    return new ResponseHeadersPolicy(this, id, {
      // Public assets (widget.js, the chat iframe) are loaded cross-origin from
      // arbitrary tenant sites, so allow any origin. This makes the response
      // carry Access-Control-Allow-Origin, which the browser requires to execute
      // a `crossorigin`/module script and to read cross-origin fetches. It does
      // NOT weaken anything: these are public, unauthenticated static assets.
      ...(publicCors
        ? {
            corsBehavior: {
              accessControlAllowOrigins: ["*"],
              accessControlAllowHeaders: ["*"],
              accessControlAllowMethods: ["GET", "HEAD", "OPTIONS"],
              accessControlAllowCredentials: false,
              originOverride: true
            }
          }
        : {}),
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        // The chat surface must be framable by tenant sites; framing is
        // governed by the CSP frame-ancestors directive instead of XFO.
        ...(framable
          ? {}
          : {
              frameOptions: {
                frameOption: HeadersFrameOption.DENY,
                override: true
              }
            }),
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true
        },
        referrerPolicy: {
          referrerPolicy: "strict-origin-when-cross-origin" as never,
          override: true
        },
        contentSecurityPolicy: {
          contentSecurityPolicy: csp,
          override: true
        }
      }
    });
  }

  private makeDistribution(opts: {
    id: string;
    zone: IHostedZone;
    domain: string;
    bucket: Bucket;
    responseHeadersPolicy: ResponseHeadersPolicy;
    webAclId: string;
    rootObject: string;
    spa?: boolean;
  }): Distribution {
    const cert = new Certificate(this, `${opts.id}Cert`, {
      domainName: opts.domain,
      validation: CertificateValidation.fromDns(opts.zone)
      // CloudFront requires certs in us-east-1; stack should be deployed there.
    });

    const dist = new Distribution(this, opts.id, {
      domainNames: [opts.domain],
      certificate: cert,
      webAclId: opts.webAclId,
      defaultRootObject: opts.rootObject,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(opts.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: opts.responseHeadersPolicy,
        compress: true
      },
      errorResponses: opts.spa
        ? [
            { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
            { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" }
          ]
        : undefined
    });

    new ARecord(this, `${opts.id}Alias`, {
      zone: opts.zone,
      recordName: opts.domain,
      target: RecordTarget.fromAlias(new CloudFrontTarget(dist))
    });

    return dist;
  }
}
