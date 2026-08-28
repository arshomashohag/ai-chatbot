import { z } from "zod";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  env: z.string(),
  version: z.string()
});

export type HealthResponse = z.infer<typeof HealthResponse>;
