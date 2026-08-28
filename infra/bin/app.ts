import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config.js";
import { DataStack } from "../lib/data-stack.js";
import { ApiStack } from "../lib/api-stack.js";
import { EdgeStack } from "../lib/edge-stack.js";

const app = new App();
const config = loadConfig();

const cdkEnv = {
  account: config.account,
  region: config.region
};

const prefix = `Platform-${config.env}`;

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
