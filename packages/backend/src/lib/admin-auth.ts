import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { getUserTenantId } from "./admin-ddb.js";

export class AdminAuthError extends Error {}

export function cognitoSub(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): string {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== "string" || !sub) {
    throw new AdminAuthError("missing sub");
  }
  return sub;
}

export async function tenantForCaller(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<string> {
  const sub = cognitoSub(event);
  const tenantId = await getUserTenantId(sub);
  if (!tenantId) throw new AdminAuthError("no tenant for user");
  return tenantId;
}
