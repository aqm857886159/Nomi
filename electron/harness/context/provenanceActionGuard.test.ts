import { describe, expect, it } from "vitest";
import { createProvenanceMark } from "./provenance";
import { classifyToolAction, evaluateProvenanceAction } from "./provenanceActionGuard";

const tainted = createProvenanceMark("web_fetched", "https://example.test/prompt");

describe("provenance action guard", () => {
  it("requires explicit confirmation for spend, project writes, and egress", () => {
    for (const toolName of ["nomi_start_generation", "nomi_document_edit", "nomi_export_job"]) {
      const action = classifyToolAction(toolName);
      const decision = evaluateProvenanceAction(action, [tainted]);
      expect(decision).toMatchObject({
        allowed: false,
        requiresConfirmation: true,
        taintedSourceRefs: ["https://example.test/prompt"],
      });
    }
  });

  it("allows read-only tools and clean sources without a confirmation", () => {
    expect(evaluateProvenanceAction(classifyToolAction("nomi_media_query"), [tainted])).toMatchObject({
      allowed: true,
      requiresConfirmation: false,
    });
    expect(evaluateProvenanceAction(classifyToolAction("nomi_document_edit"), [
      createProvenanceMark("host_derived", "agent.capability"),
    ])).toMatchObject({ allowed: true, requiresConfirmation: false });
  });
});
