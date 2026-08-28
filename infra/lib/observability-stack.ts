import { Stack, type StackProps, Duration } from "aws-cdk-lib";
import type { Construct } from "constructs";
import {
  Dashboard,
  GraphWidget,
  Alarm,
  ComparisonOperator,
  TreatMissingData,
  Metric
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Topic } from "aws-cdk-lib/aws-sns";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import type { Table } from "aws-cdk-lib/aws-dynamodb";
import type { EnvName } from "./config.js";

export interface ObservabilityStackProps extends StackProps {
  envName: EnvName;
  chatFn: IFunction;
  sessionFn: IFunction;
  table: Table;
}

export class ObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { envName, chatFn, sessionFn, table } = props;

    const alarmTopic = new Topic(this, "AlarmTopic", {
      topicName: `platform-${envName}-alarms`
    });
    const action = new SnsAction(alarmTopic);

    const chatErrors = chatFn.metricErrors({ period: Duration.minutes(5) });
    const chatP95 = chatFn.metricDuration({
      period: Duration.minutes(5),
      statistic: "p95"
    });
    const ddbThrottle = new Metric({
      namespace: "AWS/DynamoDB",
      metricName: "ThrottledRequests",
      dimensionsMap: { TableName: table.tableName },
      period: Duration.minutes(5),
      statistic: "Sum"
    });

    const errorAlarm = new Alarm(this, "ChatErrorAlarm", {
      metric: chatErrors,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });
    errorAlarm.addAlarmAction(action);

    const latencyAlarm = new Alarm(this, "ChatLatencyAlarm", {
      metric: chatP95,
      threshold: 15000,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });
    latencyAlarm.addAlarmAction(action);

    const throttleAlarm = new Alarm(this, "DdbThrottleAlarm", {
      metric: ddbThrottle,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });
    throttleAlarm.addAlarmAction(action);

    const dashboard = new Dashboard(this, "Dashboard", {
      dashboardName: `platform-${envName}`
    });
    dashboard.addWidgets(
      new GraphWidget({
        title: "Chat latency (p50/p95)",
        left: [
          chatFn.metricDuration({ statistic: "p50" }),
          chatFn.metricDuration({ statistic: "p95" })
        ]
      }),
      new GraphWidget({
        title: "Invocations & errors",
        left: [chatFn.metricInvocations(), chatFn.metricErrors()],
        right: [sessionFn.metricErrors()]
      }),
      new GraphWidget({
        title: "DynamoDB throttles",
        left: [ddbThrottle]
      })
    );
  }
}
