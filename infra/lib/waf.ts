import type { Construct } from "constructs";
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";

export function makeWebAcl(
  scope: Construct,
  id: string,
  wafScope: "REGIONAL" | "CLOUDFRONT",
  env: string
): CfnWebACL {
  return new CfnWebACL(scope, id, {
    scope: wafScope,
    defaultAction: { allow: {} },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: `${id}-${env}`,
      sampledRequestsEnabled: true
    },
    rules: [
      {
        name: "RateLimitPerIp",
        priority: 1,
        action: { block: {} },
        statement: {
          rateBasedStatement: { limit: 1000, aggregateKeyType: "IP" }
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${id}-ratelimit`,
          sampledRequestsEnabled: true
        }
      },
      {
        name: "CommonRuleSet",
        priority: 2,
        overrideAction: { none: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesCommonRuleSet"
          }
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${id}-common`,
          sampledRequestsEnabled: true
        }
      }
    ]
  });
}
