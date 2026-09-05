import { describe, expect, it } from "vitest";
import {
  projectAgentExecutionRisk,
  projectAgentMayReuseSafeApproval,
  projectAgentWorkModeDecision,
} from "./projectAgentExecutionPolicy";
import { projectAgentApprovalPolicyOf } from "../shared/projectAgentContracts";

describe("Project Agent approval policy", () => {
  it("defaults local reversible actions to this-session approval and spend to per-action confirmation", () => {
    expect(projectAgentApprovalPolicyOf(undefined)).toEqual({ mode: "safe-auto", spend: "confirm" });
    // This-session approval, not no approval: the first reversible write asks,
    // the rest of the session reuses that one answer.
    expect(projectAgentMayReuseSafeApproval(undefined, "nomi_document_edit", { operation: "append" }, false)).toBe(false);
    expect(projectAgentMayReuseSafeApproval(undefined, "nomi_document_edit", { operation: "append" }, true)).toBe(true);
    expect(projectAgentMayReuseSafeApproval(undefined, "nomi_request_generation_gate", {}, false)).toBe(false);
    expect(projectAgentMayReuseSafeApproval(undefined, "export_timeline", {}, false)).toBe(false);
    expect(projectAgentMayReuseSafeApproval(undefined, "delete_canvas_nodes", {}, false)).toBe(false);
  });

  it.each([
    ["canvas edit: create nodes", "nomi_canvas_edit", "create_canvas_nodes"],
    ["canvas edit: set prompt", "nomi_canvas_edit", "set_node_prompt"],
    ["canvas edit: connect edges", "nomi_canvas_edit", "connect_canvas_edges"],
    ["canvas edit: tidy layout", "nomi_canvas_edit", "tidy_canvas"],
    ["canvas plan: patch shots", "nomi_canvas_plan", "patch_shots"],
    ["canvas plan: propose storyboard", "nomi_canvas_plan", "propose_storyboard_plan"],
    ["canvas plan: staging reference", "nomi_canvas_plan", "create_staging_reference"],
    ["canvas plan: camera move", "nomi_canvas_plan", "create_camera_move"],
    ["canvas plan: arrange timeline", "nomi_canvas_plan", "arrange_storyboard_to_timeline"],
    ["canvas maintenance: undo delete", "nomi_canvas_maintenance", "undo_canvas_delete"],
    ["document edit: current operations", "nomi_document_edit", ["insert", "replace", "append"]],
    ["timeline preview", "propose_edit_plan", "propose_edit_plan"],
    ["timeline apply", "apply_edit_plan", "apply_edit_plan"],
  ] as const)("classifies %s from capability facts", (_label, toolName, operation) => {
    const operations = Array.isArray(operation) ? operation : [operation];
    for (const currentOperation of operations) {
      expect(projectAgentExecutionRisk(toolName, { operation: currentOperation })).toBe("safe-reversible");
    }
  });

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
    expect(projectAgentExecutionRisk("nomi_canvas_edit", { operation: "unregistered_canvas_operation" })).toBe("hard-gate");
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
    // "One explicit approval" means the first reversible write still asks; only
    // then may a later one reuse it. Otherwise the intervention slot never opens.
    expect(projectAgentMayReuseSafeApproval(safeAuto, "nomi_document_edit", { operation: "append" }, false)).toBe(false);
    expect(projectAgentMayReuseSafeApproval(safeAuto, "append_to_end", {}, true)).toBe(true);
    expect(projectAgentMayReuseSafeApproval(safeAuto, "apply_edit_plan", { operation: "apply_edit_plan" }, false)).toBe(false);
    expect(projectAgentMayReuseSafeApproval(project, "export_timeline", {}, true)).toBe(false);
    expect(projectAgentMayReuseSafeApproval(project, "nomi_operation_create", {}, true)).toBe(true);
    // "Always" needs no prior approval at all; the default policy still does.
    expect(projectAgentMayReuseSafeApproval(project, "apply_edit_plan", { operation: "apply_edit_plan" }, false)).toBe(true);
    expect(projectAgentMayReuseSafeApproval(undefined, "nomi_document_edit", { operation: "append" }, true)).toBe(true);
    expect(projectAgentMayReuseSafeApproval(undefined, "nomi_document_edit", { operation: "append" }, false)).toBe(false);
  });

  it("makes Ask read-only at the Host boundary", () => {
    expect(projectAgentWorkModeDecision("ask", "read_full_text", {})).toEqual({ allowed: true });
    expect(projectAgentWorkModeDecision("ask", "append_to_end", { content: "draft" })).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("Ask"),
    });
    expect(projectAgentWorkModeDecision("ask", "unknown_tool", {})).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("Ask"),
    });
  });

  it("keeps edit-selection from starting paid or destructive work", () => {
    expect(projectAgentWorkModeDecision("editSelection", "replace_selection", { content: "new" })).toEqual({ allowed: true });
    expect(projectAgentWorkModeDecision("editSelection", "nomi_start_generation", {})).toMatchObject({ allowed: false });
    expect(projectAgentWorkModeDecision("editSelection", "delete_canvas_nodes", {})).toMatchObject({ allowed: false });
  });
});
