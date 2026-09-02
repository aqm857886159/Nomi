import { describe, expect, it } from "vitest";
import {
  projectAgentExecutionRisk,
  projectAgentMayReuseSafeApproval,
} from "./projectAgentExecutionPolicy";

describe("Project Agent approval policy", () => {
  it("keeps paid, destructive, export, and unknown operations hard gated", () => {
    for (const name of [
      "nomi_request_generation_gate",
      "delete_canvas_nodes",
      "export_timeline",
      "publish_project",
      "unknown_write",
    ]) {
      expect(projectAgentExecutionRisk(name)).toBe("hard-gate");
    }
  });

  it("recognizes only the reversible edit allow-list", () => {
    expect(projectAgentExecutionRisk("append_to_end", { content: "draft" })).toBe("safe-reversible");
    expect(projectAgentExecutionRisk("set_node_prompt", { operation: "set_node_prompt" })).toBe("safe-reversible");
    expect(projectAgentExecutionRisk("apply_edit_plan", { operation: "apply_edit_plan" })).toBe("safe-reversible");
    expect(projectAgentExecutionRisk("nomi_start_generation", { operation: "start" })).toBe("hard-gate");
  });

  it("reuses one explicit approval only for a later reversible write", () => {
    const safeAuto = { mode: "safe-auto" as const, spend: "confirm" as const };
    const project = { mode: "project" as const, spend: "within-budget" as const };
    expect(projectAgentMayReuseSafeApproval(safeAuto, "append_to_end", {}, false)).toBe(false);
    expect(projectAgentMayReuseSafeApproval(safeAuto, "append_to_end", {}, true)).toBe(true);
    expect(projectAgentMayReuseSafeApproval(project, "export_timeline", {}, true)).toBe(false);
    expect(projectAgentMayReuseSafeApproval(project, "nomi_operation_create", {}, true)).toBe(false);
    expect(projectAgentMayReuseSafeApproval(undefined, "append_to_end", {}, true)).toBe(false);
  });
});
