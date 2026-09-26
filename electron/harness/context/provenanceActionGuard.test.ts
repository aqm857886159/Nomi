import { describe, expect, it } from "vitest";
import { createProvenanceMark } from "./provenance";
import { evaluateProvenanceAction } from "./provenanceActionGuard";

const tainted = createProvenanceMark("web_fetched", "https://example.test/prompt");

describe("provenance action guard", () => {
  it("requires explicit confirmation for spend, project writes, and egress", () => {
    for (const action of ["spend", "write", "egress"] as const) {
      const decision = evaluateProvenanceAction(action, [tainted]);
      expect(decision).toMatchObject({
        allowed: false,
        requiresConfirmation: true,
        taintedSourceRefs: ["https://example.test/prompt"],
      });
    }
  });

  it("allows read-only tools and clean sources without a confirmation", () => {
    expect(evaluateProvenanceAction("read", [tainted])).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
    });
    expect(evaluateProvenanceAction("write", [
      createProvenanceMark("host_derived", "agent.capability"),
    ])).toMatchObject({ allowed: true, requiresConfirmation: false });
  });
});
