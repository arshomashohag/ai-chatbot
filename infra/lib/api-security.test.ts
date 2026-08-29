import { describe, it, expect, beforeAll } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { DataStack } from "./data-stack.js";
import { ApiStack } from "./api-stack.js";
import type { PlatformConfig } from "./config.js";

// 3.31: assert security-relevant template properties so a misconfiguration that
// (e.g.) exposes admin routes unauthenticated or weakens the KMS key is caught.
const config: PlatformConfig = {
  env: "dev",
  domainName: "example.com",
  region: "us-east-1",
  hostedZoneId: "Z123456",
  subdomains: {
    cdn: "chatbot-cdn-dev.example.com",
    api: "chatbot-api-dev.example.com",
    chat: "chatbot-chat-dev.example.com",
    app: "chatbot-app-dev.example.com",
    site: "chatbot-site-dev.example.com"
  }
};

describe("ApiStack security posture", () => {
  let template: Template;

  beforeAll(() => {
    // Skip esbuild asset bundling for the NodejsFunctions — we only assert on
    // the synthesized template's security properties, not the Lambda code.
    const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
    const env = { account: "111111111111", region: "us-east-1" };
    const data = new DataStack(app, "TestData", { env, envName: "dev" });
    const api = new ApiStack(app, "TestApi", { env, config, table: data.table });
    template = Template.fromStack(api);
  });

  it("signs widget JWTs with an ECC_NIST_P256 SIGN_VERIFY KMS key", () => {
    template.hasResourceProperties("AWS::KMS::Key", {
      KeySpec: "ECC_NIST_P256",
      KeyUsage: "SIGN_VERIFY"
    });
  });

  it("attaches a JWT authorizer to the admin routes", () => {
    // The admin proxy route must carry an authorizer id.
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: Match.stringLikeRegexp("/v1/admin/"),
      AuthorizerId: Match.anyValue()
    });
    // A JWT authorizer exists.
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT"
    });
  });

  it("leaves the public widget + health routes UNauthenticated", () => {
    const routes = template.findResources("AWS::ApiGatewayV2::Route");
    for (const r of Object.values(routes)) {
      const key = (r as { Properties: { RouteKey: string; AuthorizerId?: unknown } })
        .Properties.RouteKey;
      const hasAuth = "AuthorizerId" in
        (r as { Properties: Record<string, unknown> }).Properties;
      if (key.includes("/health") || key.includes("/v1/widget/")) {
        expect(hasAuth).toBe(false);
      }
    }
  });

  it("scopes tenant-data IAM to TENANT#-prefixed leading keys", () => {
    // At least one policy uses the LeadingKeys condition (defense-in-depth doc'd;
    // the app-layer guard is the real cross-tenant control — see tenant.ts).
    const policies = template.findResources("AWS::IAM::Policy");
    const json = JSON.stringify(policies);
    expect(json).toContain("dynamodb:LeadingKeys");
    expect(json).toContain("TENANT#");
  });
});
