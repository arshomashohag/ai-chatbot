import { SearchProductsArgs, type ToolCall } from "@platform/shared";
import { searchProducts } from "./ddb.js";

const TOOL_TIMEOUT_MS = 8_000;
const MAX_RESULT_CHARS = 4_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("tool timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function executeTool(
  tenantId: string,
  call: ToolCall
): Promise<string> {
  try {
    if (call.name === "search_products") {
      const args = SearchProductsArgs.parse(call.arguments);
      const products = await withTimeout(
        searchProducts(tenantId, args.query),
        TOOL_TIMEOUT_MS
      );
      const out = JSON.stringify({ products });
      return out.slice(0, MAX_RESULT_CHARS);
    }
    return JSON.stringify({ error: `unknown tool: ${call.name}` });
  } catch {
    return JSON.stringify({
      error: "I couldn't look that up right now."
    });
  }
}
