import { Stack, type StackProps, RemovalPolicy } from "aws-cdk-lib";
import type { Construct } from "constructs";
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
  TableEncryption
} from "aws-cdk-lib/aws-dynamodb";
import type { EnvName } from "./config.js";

export interface DataStackProps extends StackProps {
  envName: EnvName;
}

export class DataStack extends Stack {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.table = new Table(this, "PlatformTable", {
      tableName: `platform-${props.envName}`,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: props.envName === "prod"
      },
      removalPolicy:
        props.envName === "prod"
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    });
  }
}
