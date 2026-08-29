import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { getUserTenantId, ensureUserTenant } from "./admin-ddb.js";

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

function cognitoEmail(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): string {
  const email = event.requestContext.authorizer?.jwt?.claims?.email;
  return typeof email === "string" ? email : "";
}

export async function tenantForCaller(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<string> {
  const sub = cognitoSub(event);
  const existing = await getUserTenantId(sub);
  if (existing) return existing;
  // Lazy provisioning: the caller has a valid, verified Cognito identity but no
  // tenant record — this happens if the post-confirmation trigger never ran or
  // failed (e.g. a transient error, or a trigger bug). Rather than lock the user
  // out permanently, provision their tenant now. ensureUserTenant is idempotent,
  // so this is safe even if the trigger later runs or two requests race.
  return ensureUserTenant(sub, cognitoEmail(event));
}
