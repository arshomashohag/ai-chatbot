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

export function sessionPk(tenantId: string, sessionId: string): string {
  return `TENANT#${tenantId}#SESSION#${sessionId}`;
}

export function messageSk(isoTs: string, id: string): string {
  return `MSG#${isoTs}#${id}`;
}

export function productSk(productId: string): string {
  return `PRODUCT#${productId}`;
}

export function usageSk(month: string): string {
  return `USAGE#${month}`;
}

export function userPk(cognitoSub: string): string {
  return `USER#${cognitoSub}`;
}

export function profileSk(): string {
  return "PROFILE";
}

export function kbSk(id: string): string {
  return `KB#${id}`;
}
