import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config.js";
import { DataStack } from "../lib/data-stack.js";
import { ApiStack } from "../lib/api-stack.js";
import { EdgeStack } from "../lib/edge-stack.js";
import { ObservabilityStack } from "../lib/observability-stack.js";

const app = new App();
const config = loadConfig();

const cdkEnv = {
  account: config.account,
  region: config.region
};

const prefix = `ChatbotPlatform-${config.env}`;

const data = new DataStack(app, `${prefix}-Data`, {
  env: cdkEnv,
  envName: config.env
});

const api = new ApiStack(app, `${prefix}-Api`, {
  env: cdkEnv,
  config,
  table: data.table
});

api.addDependency(data);

new EdgeStack(app, `${prefix}-Edge`, {
  env: cdkEnv,
  config
});

const obs = new ObservabilityStack(app, `${prefix}-Observability`, {
  env: cdkEnv,
  envName: config.env,
  chatFn: api.chatFn,
  sessionFn: api.sessionFn,
  table: data.table
});
obs.addDependency(api);
