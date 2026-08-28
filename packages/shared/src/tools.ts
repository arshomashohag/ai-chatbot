import { z } from "zod";

export const SearchProductsArgs = z.object({
  query: z.string().min(1).max(200)
});
export type SearchProductsArgs = z.infer<typeof SearchProductsArgs>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const SEARCH_PRODUCTS_TOOL: ToolDefinition = {
  name: "search_products",
  description:
    "Search the store product catalog by keyword. Returns matching " +
    "products with name, price, and availability.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keywords" }
    },
    required: ["query"]
  }
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [SEARCH_PRODUCTS_TOOL];
export const MAX_TOOL_ITERATIONS = 5;
