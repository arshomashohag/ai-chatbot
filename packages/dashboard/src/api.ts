import {
  AdminConfig,
  IssueKeyResponse,
  KbEntry,
  SessionSummary,
  StoredMessage,
  type BusinessBasics,
  type Appearance,
  type KbEntryInput
} from "@platform/shared";
import { currentToken } from "./auth.js";

const API_BASE = import.meta.env.VITE_API_BASE;

async function req<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = await currentToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token ?? ""}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getConfig: () => req("GET", "/v1/admin/config").then((c) => AdminConfig.parse(c)),
  saveBasics: (b: BusinessBasics) => req("PUT", "/v1/admin/basics", b),
  saveAppearance: (a: Appearance) => req("PUT", "/v1/admin/appearance", a),
  saveProfile: (businessProfile: string) =>
    req("PUT", "/v1/admin/profile", { businessProfile }),
  listKb: () =>
    req<{ entries: KbEntry[] }>("GET", "/v1/admin/kb").then((r) => r.entries),
  addKb: (e: KbEntryInput) => req<KbEntry>("POST", "/v1/admin/kb", e),
  deleteKb: (id: string) => req("DELETE", `/v1/admin/kb/${id}`),
  issueKey: () =>
    req("POST", "/v1/admin/key").then((r) => IssueKeyResponse.parse(r)),
  listSessions: () =>
    req<{ sessions: SessionSummary[] }>("GET", "/v1/admin/sessions").then(
      (r) => r.sessions
    ),
  transcript: (id: string) =>
    req<{ sessionId: string; messages: StoredMessage[] }>(
      "GET",
      `/v1/admin/sessions/${id}`
    )
};
