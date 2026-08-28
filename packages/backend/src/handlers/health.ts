import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { HealthResponse } from "@platform/shared";
import { json } from "../lib/http.js";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  const body: HealthResponse = {
    status: "ok",
    env: process.env.ENV ?? "unknown",
    version: process.env.APP_VERSION ?? "dev"
  };
  return json(200, HealthResponse.parse(body));
};
