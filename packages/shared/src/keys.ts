export function tenantPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

export function configSk(): string {
  return "CONFIG";
}

export function sessionSk(sessionId: string): string {
  return `SESSION#${sessionId}`;
}

export function siteKeyGsi(siteKeyHash: string): {
  GSI1PK: string;
  GSI1SK: string;
} {
  return { GSI1PK: `SITEKEY#${siteKeyHash}`, GSI1SK: "TENANT" };
}
