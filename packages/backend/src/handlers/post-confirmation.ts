import type { PostConfirmationTriggerHandler } from "aws-lambda";
import { ensureUserTenant } from "../lib/admin-ddb.js";

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const sub = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email ?? "";
  if (sub) {
    await ensureUserTenant(sub, email);
  }
  return event;
};
