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

function apiSubdomain(env: EnvName, domain: string): string {
  return `chatbot-api-${env}.${domain}`;
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
      cdn: `cdn.${domainName}`,
      api: apiSubdomain(env, domainName),
      chat: `chat.${domainName}`,
      app: `app.${domainName}`,
      www: `www.${domainName}`
    }
  };
}
