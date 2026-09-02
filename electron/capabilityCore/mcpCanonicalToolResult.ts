import type { ZodType } from "zod";

export const CAPABILITY_OUTPUT_INVALID = "capability_output_invalid";

/** Public MCP boundary error: never retain the Zod issue/cause because it can contain received secrets. */
export class CapabilityOutputInvalidError extends Error {
  readonly code = CAPABILITY_OUTPUT_INVALID;

  constructor() {
    super(CAPABILITY_OUTPUT_INVALID);
    this.name = "CapabilityOutputInvalidError";
  }
}

export type CanonicalMcpToolResult<Output = unknown> = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Output;
};

/** Parse once before constructing either wire representation, so they cannot diverge or accept raw legacy data. */
export function buildCanonicalMcpToolResult<Output>(
  schema: ZodType<Output>,
  result: unknown,
): CanonicalMcpToolResult<Output> {
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new CapabilityOutputInvalidError();
  const canonical = parsed.data;
  return {
    content: [{ type: "text", text: JSON.stringify(canonical, null, 2) }],
    structuredContent: canonical,
  };
}
