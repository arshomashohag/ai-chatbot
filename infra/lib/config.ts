export type EnvName = "dev" | "staging" | "prod";

export interface PlatformConfig {
  env: EnvName;
  domainName: string;
  region: string;
  account?: string;
  hostedZoneId?: string;
  subdomains: {
    cdn: string;
    api: string;
    chat: string;
    app: string;
    www: string;
  };
}

// Every subdomain is env-specific and namespaced under `chatbot-` so multiple
// environments (and other products) can share one hosted zone without
// colliding: chatbot-<role>-<env>.<domain>. The root/apex domain is never used.
function sub(role: string, env: EnvName, domain: string): string {
  return `chatbot-${role}-${env}.${domain}`;
}

export function loadConfig(): PlatformConfig {
  const env = (process.env.ENV ?? "dev") as EnvName;
  const domainName = process.env.DOMAIN_NAME;
  if (!domainName) {
    throw new Error("DOMAIN_NAME env var is required (never hardcoded).");
  }
  const region = process.env.AWS_REGION ?? "us-east-1";
  const account = process.env.CDK_DEFAULT_ACCOUNT;
  return {
    env,
    domainName,
    region,
    account,
    hostedZoneId: process.env.HOSTED_ZONE_ID,
    subdomains: {
      cdn: sub("cdn", env, domainName),
      api: sub("api", env, domainName),
      chat: sub("chat", env, domainName),
      app: sub("app", env, domainName),
      www: sub("www", env, domainName)
    }
  };
}
