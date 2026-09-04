import { describe, expect, it } from "vitest";
import { assertProjectAgentProvenance } from "./projectAgentProvenanceValidation";

describe("assertProjectAgentProvenance", () => {
  it("accepts the full projection shape", () => {
    expect(() => assertProjectAgentProvenance([
      {
        source: "host_derived",
        sourceRef: "agent.capability",
        trust: "trusted",
        tainted: false,
      },
      {
        source: "project_asset",
        sourceRef: "asset-1",
        trust: "untrusted",
        tainted: true,
        assetEvidenceRef: "asset-1",
      },
    ])).not.toThrow();
  });

  it.each([
    ["not an array", "bad"],
    ["unknown source", [{ source: "forged", sourceRef: "ref", trust: "trusted", tainted: false }]],
    ["empty source ref", [{ source: "host_derived", sourceRef: "", trust: "trusted", tainted: false }]],
    ["unknown trust", [{ source: "host_derived", sourceRef: "ref", trust: "forged", tainted: false }]],
    ["non-boolean tainted", [{ source: "host_derived", sourceRef: "ref", trust: "trusted", tainted: "false" }]],
    ["empty asset evidence ref", [{ source: "host_derived", sourceRef: "ref", trust: "trusted", tainted: false, assetEvidenceRef: "" }]],
    ["unknown field", [{ source: "host_derived", sourceRef: "ref", trust: "trusted", tainted: false, extra: true }]],
  ] as const)("rejects %s", (_label, value) => {
    expect(() => assertProjectAgentProvenance(value)).toThrowError("invalid_state");
  });
});
