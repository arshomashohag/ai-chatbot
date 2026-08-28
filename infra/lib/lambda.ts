import { Duration } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import {
  NodejsFunction,
  OutputFormat,
  type NodejsFunctionProps
} from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const backendSrc = resolve(here, "../../packages/backend/src");

export interface HandlerProps
  extends Omit<NodejsFunctionProps, "entry" | "runtime"> {
  handlerFile: string;
}

export function nodeHandler(
  scope: Construct,
  id: string,
  props: HandlerProps
): NodejsFunction {
  const { handlerFile, environment, ...rest } = props;
  return new NodejsFunction(scope, id, {
    runtime: Runtime.NODEJS_22_X,
    entry: resolve(backendSrc, "handlers", handlerFile),
    handler: "handler",
    timeout: Duration.seconds(30),
    memorySize: 512,
    logRetention: RetentionDays.ONE_MONTH,
    bundling: { format: OutputFormat.ESM, target: "node22", minify: true },
    environment,
    ...rest
  });
}
