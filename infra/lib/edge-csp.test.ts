import { describe, it, expect, beforeAll } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { EdgeStack } from "./edge-stack.js";
import type { PlatformConfig } from "./config.js";

// U7: per-surface CSP. Assert the chat surface is framable and the others are
// not, and that script-src is never 'unsafe-inline'.
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

describe("EdgeStack CSP (finding 1.5)", () => {
  let policies: string[];

  beforeAll(() => {
    const app = new App();
    const stack = new EdgeStack(app, "TestEdge", {
      env: { account: "111111111111", region: "us-east-1" },
      config
    });
    const template = Template.fromStack(stack);
    const found = template.findResources(
      "AWS::CloudFront::ResponseHeadersPolicy"
    );
    policies = Object.values(found).map(
      (r) =>
        (r as {
          Properties: {
            ResponseHeadersPolicyConfig: {
              SecurityHeadersConfig: {
                ContentSecurityPolicy?: { ContentSecurityPolicy: string };
              };
            };
          };
        }).Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig
          .ContentSecurityPolicy?.ContentSecurityPolicy ?? ""
    );
  });

  it("creates a CSP for every served surface (4 policies)", () => {
    expect(policies.filter((p) => p.length > 0).length).toBe(4);
  });

  it("never allows script-src 'unsafe-inline' (XSS-relevant directive stays strict)", () => {
    for (const p of policies) {
      const scriptSrc = /script-src([^;]*)/.exec(p)?.[1] ?? "";
      expect(scriptSrc).not.toContain("unsafe-inline");
    }
  });

  it("makes exactly the chat surface framable (frame-ancestors *)", () => {
    const framable = policies.filter((p) => /frame-ancestors \*/.test(p));
    const notFramable = policies.filter((p) =>
      /frame-ancestors 'none'/.test(p)
    );
    expect(framable.length).toBe(1); // only chat
    expect(notFramable.length).toBe(3); // cdn, marketing, portal
    // The framable one connects to the API (it's the chat surface).
    expect(framable[0]).toContain("chatbot-api-dev.example.com");
  });

  it("scopes portal connect-src to Cognito + API", () => {
    const portal = policies.find((p) => p.includes("cognito-idp"));
    expect(portal).toBeTruthy();
    expect(portal).toContain("chatbot-api-dev.example.com");
  });
});
