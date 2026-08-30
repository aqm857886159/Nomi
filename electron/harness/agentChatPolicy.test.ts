import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CANVAS_WRITE_CAPABILITY,
  canvasWritePiDescriptionForAlias,
  canvasWritePiInputSchema,
  canvasWritePiInputSchemaForAlias,
} from "../shared/agentCapabilities/canvasWrite";
import {
  CANVAS_DELETE_CAPABILITY,
  canvasDeletePiDescriptionForAlias,
  canvasDeletePiInputSchema,
} from "../shared/agentCapabilities/canvasDelete";
import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import { capabilityOperationAliasesFor } from "../shared/agentCapabilities/registry";
import {
  agentToolsForCapability,
  agentToolsForCapabilityAndSkill,
  agentToolsForRequest,
  agentToolIsInScope,
  mergeAgentToolProfiles,
  resolveAgentToolProfile,
} from "./agentChatPolicy";
import { canvasToolDescriptors } from "./tools/canvasDescriptors";

describe("Project Agent Pi capability projection", () => {
  it("projects canvas.write from the Registry and leaves no hand-written descriptor owner", () => {
    const tools = agentToolsForCapability("canvas-refine");
    expect(tools).toEqual([
      {
        name: CANVAS_WRITE_CAPABILITY.aliases.pi,
        description: CANVAS_WRITE_CAPABILITY.projections.pi.description,
        schema: canvasWritePiInputSchema,
      },
    ]);
    expect(canvasWritePiInputSchema.safeParse({ nodeId: "node-a", prompt: "new prompt" }).success).toBe(true);
    expect(canvasToolDescriptors).not.toHaveProperty(CANVAS_WRITE_CAPABILITY.aliases.pi);

    const aliases = [
      CANVAS_WRITE_CAPABILITY.aliases.pi,
      ...capabilityOperationAliasesFor(CANVAS_WRITE_CAPABILITY.id, "pi"),
    ];
    const canvasAgentTools = agentToolsForCapability("canvas-agent");
    for (const alias of aliases) {
      expect(canvasAgentTools).toContainEqual({
        name: alias,
        description: canvasWritePiDescriptionForAlias(alias),
        schema: canvasWritePiInputSchemaForAlias(alias),
      });
      expect(canvasToolDescriptors).not.toHaveProperty(alias);
    }
    expect(canvasAgentTools).toContainEqual({
      name: CANVAS_DELETE_CAPABILITY.aliases.pi,
      description: canvasDeletePiDescriptionForAlias(CANVAS_DELETE_CAPABILITY.aliases.pi),
      schema: canvasDeletePiInputSchema,
    });
    expect(canvasToolDescriptors).not.toHaveProperty(CANVAS_DELETE_CAPABILITY.aliases.pi);
    expect(canvasDeletePiInputSchema.parse({ nodeIds: ["obsolete-shot"], reason: "Removed by the creator" }))
      .toEqual({ nodeIds: ["obsolete-shot"], reason: "Removed by the creator" });
    expect(tools.map(({ name }) => name)).toEqual([CANVAS_WRITE_CAPABILITY.aliases.pi]);

    const policySource = readFileSync(new URL("./agentChatPolicy.ts", import.meta.url), "utf8");
    const descriptorSource = readFileSync(new URL("./tools/canvasDescriptors.ts", import.meta.url), "utf8");
    expect(policySource).not.toContain("canvas.set_node_prompt");
    expect(descriptorSource).not.toContain("set_node_prompt");
    expect(descriptorSource).not.toContain("delete_canvas_nodes");
  });

  it("lets a Skill shrink but never expand the Host capability ceiling", () => {
    const hostTools = agentToolsForCapability("canvas-agent");
    expect(agentToolsForCapabilityAndSkill("canvas-agent", undefined)).toEqual(hostTools);
    expect(agentToolsForCapabilityAndSkill("canvas-agent", [CANVAS_WRITE_CAPABILITY.id]).map(({ name }) => name))
      .toEqual([
        CANVAS_WRITE_CAPABILITY.aliases.pi,
        ...capabilityOperationAliasesFor(CANVAS_WRITE_CAPABILITY.id, "pi"),
      ]);
    expect(agentToolsForCapabilityAndSkill("canvas-refine", [CANVAS_READ_CAPABILITY.id])).toEqual([]);
    expect(() => agentToolsForCapabilityAndSkill("canvas-agent", ["read_canvas_state"])).toThrow(
      "Unknown canonical Skill capability",
    );
  });

  it("selects a small goal profile without changing the canonical capability ceiling", () => {
    expect(resolveAgentToolProfile({ capability: "canvas-agent", prompt: "帮我生成一个小猫头像" })).toBe("generation");
    expect(resolveAgentToolProfile({ capability: "canvas-agent", prompt: "把第三个镜头剪掉并导出" })).toBe("timeline");
    expect(resolveAgentToolProfile({ capability: "canvas-agent", prompt: "做一个 5 分钟的品牌短片" })).toBe("production");
    expect(resolveAgentToolProfile({ capability: "canvas-agent", prompt: "设计两个人对峙的镜头并安排站位" })).toBe("storyboard");
    expect(mergeAgentToolProfiles(undefined, "generation")).toBe("generation");
    expect(mergeAgentToolProfiles("timeline", "generation")).toBe("timeline");
    expect(mergeAgentToolProfiles("storyboard", "timeline")).toBe("production");
    expect(mergeAgentToolProfiles("production", "generation")).toBe("production");

    const generation = agentToolsForRequest({ capability: "canvas-agent", prompt: "帮我生成一个小猫头像" } as never);
    expect(generation.map(({ name }) => name)).toEqual([
      "read_canvas_state", "set_node_prompt", "create_canvas_nodes", "connect_canvas_edges",
    ]);
    expect(generation).not.toEqual(agentToolsForCapability("canvas-agent"));

    const timeline = agentToolsForRequest({ capability: "canvas-agent", prompt: "检查时间线并导出" } as never);
    expect(timeline.map(({ name }) => name)).toEqual([
      "read_canvas_state", "set_node_prompt", "create_canvas_nodes", "connect_canvas_edges",
      "get_media", "inspect_media", "search_media", "inspect_source_range", "read_waveform",
      "inspect_export_job", "verify_render", "export_timeline", "cancel_export_job",
      "read_timeline", "inspect_timeline_range", "propose_edit_plan", "apply_edit_plan", "undo_timeline_edit",
    ]);
    const timelineSkill = agentToolsForRequest(
      { capability: "canvas-agent", prompt: "检查时间线并导出" } as never,
      ["canvas.read", "asset.read", "timeline.read", "timeline.write", "export.read", "export.write"],
    );
    expect(timelineSkill.map(({ name }) => name)).toEqual([
      "read_canvas_state",
      "get_media", "inspect_media", "search_media", "inspect_source_range", "read_waveform",
      "inspect_export_job", "verify_render", "export_timeline", "cancel_export_job",
      "read_timeline", "inspect_timeline_range", "propose_edit_plan", "apply_edit_plan", "undo_timeline_edit",
    ]);

    const production = agentToolsForRequest({ capability: "canvas-agent", prompt: "做一个 5 分钟的品牌短片" } as never);
    expect(production.map(({ name }) => name)).toContain("start_production_run");
    expect(production.map(({ name }) => name)).toContain("materialize_production_storyboard");
    expect(agentToolsForRequest(
      { capability: "canvas-agent", prompt: "读取当前成片任务" } as never,
      ["production.run.read"],
    ).map(({ name }) => name)).toEqual([
      "get_production_run", "subscribe_production_run", "read_production_artifact", "read_production_artifact_content",
    ]);
    const productionRequest = { capability: "canvas-agent", prompt: "做一个 5 分钟的品牌短片" } as never;
    expect(agentToolIsInScope(productionRequest, { toolName: "start_production_run", toolCallId: "call-1", args: {} } as never)).toBe(true);
  });
});
