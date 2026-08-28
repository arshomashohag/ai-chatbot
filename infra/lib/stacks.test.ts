import { describe, it, beforeAll } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { DataStack } from "./data-stack.js";

describe("DataStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new DataStack(app, "TestData", {
      env: { account: "111111111111", region: "us-east-1" },
      envName: "dev"
    });
    template = Template.fromStack(stack);
  });

  it("creates the single table named platform-dev with TTL", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "platform-dev",
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true }
    });
  });

  it("creates GSI1 for site-key lookup", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      GlobalSecondaryIndexes: [{ IndexName: "GSI1" }]
    });
  });
});
