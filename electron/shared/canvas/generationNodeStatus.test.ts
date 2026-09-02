import { describe, expect, it } from "vitest";
import {
  GENERATION_NODE_STATUSES,
  generationNodeStatusSchema,
  parseGenerationNodeStatus,
} from "./generationNodeStatus";

describe("generation node status contract", () => {
  it("keeps the runtime schema and parser derived from the canonical tuple", () => {
    expect(generationNodeStatusSchema.options).toEqual([...GENERATION_NODE_STATUSES]);

    for (const status of GENERATION_NODE_STATUSES) {
      expect(generationNodeStatusSchema.parse(status)).toBe(status);
      expect(parseGenerationNodeStatus(status)).toBe(status);
    }

    expect(parseGenerationNodeStatus("not-a-generation-status")).toBeUndefined();
    expect(parseGenerationNodeStatus({ status: "idle" })).toBeUndefined();
  });
});
