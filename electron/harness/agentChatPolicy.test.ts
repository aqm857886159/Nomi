import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CANVAS_WRITE_CAPABILITY,
  canvasWritePiInputSchema,
} from "../shared/agentCapabilities/canvasWrite";
import {
  canvasDeletePiInputSchema,
} from "../shared/agentCapabilities/canvasDelete";
import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import {
  captureAgentChatRequest,
  agentToolsForCapability,
  agentToolsForCapabilityAndSkill,
  agentToolsForRequest,
  agentToolIsInScope,
  mergeAgentToolProfiles,
  resolveAgentToolProfile,
} from "./agentChatPolicy";
import { canvasToolDescriptors } from "./tools/canvasDescriptors";

describe("Project Agent Pi capability projection", () => {
  // 2026-09-03 真实付费闭环走查的功能哑火回归。
  // 机制：工具 profile 靠一张手写关键词表猜用户措辞，而那张表和产品自己的文案脱钩——
  // 侧栏按钮叫「新建分镜方案」、选中浮条叫「拆成镜头」、旧命令叫「拆镜头」，
  // 而 STORYBOARD_INTENT 里只有「分镜/镜头卡/镜头设计」，于是点按钮发出的请求拿不到
  // nomi_canvas_plan，整条拆镜功能静默哑掉（类型合法、CI 全绿）。
  //
  // 两道保险，缺一不可：
  //  ① 显式通道——我们自己知道用户意图的入口必须直接声明 toolProfile，根本不进词表；
  //  ② 词表兜底——自由文本仍要猜，那就至少收录产品自己教给用户的说法。
  it.each([
    "拆镜头",
    "拆成镜头",
    "把这个故事拆成 8 个镜头",
    "新建分镜方案",
    "帮我做一份分镜",
  ])("产品自己教给用户的说法必须路由到 storyboard profile：%s", (prompt) => {
    expect(resolveAgentToolProfile({ capability: "creation-editor", prompt } as never)).toBe("storyboard");
    expect(agentToolsForRequest({ capability: "creation-editor", prompt } as never).map(({ name }) => name))
      .toContain("nomi_canvas_plan");
  });

  it("显式 toolProfile 压过词表：入口知道意图时不再靠猜", () => {
    // 这句话一个关键词都不带，词表必然猜不中——正是显式通道存在的理由。
    const prompt = "按我刚写的那段内容往下做";
    expect(resolveAgentToolProfile({ capability: "creation-editor", prompt } as never)).toBe("creation");
    expect(agentToolsForRequest({ capability: "creation-editor", prompt } as never).map(({ name }) => name))
      .not.toContain("nomi_canvas_plan");
    expect(agentToolsForRequest({ capability: "creation-editor", prompt, toolProfile: "storyboard" } as never).map(({ name }) => name))
      .toContain("nomi_canvas_plan");
  });

  it("rejects an unknown work mode at the request boundary", () => {
    expect(() => captureAgentChatRequest({
      capability: "creation-chat",
      prompt: "hello",
      history: { kind: "ephemeral" },
      workMode: "run-everything" as never,
    })).toThrow("Invalid Agent work mode");
  });

  it("projects the semantic canvas write intent through the Host catalog", () => {
    const tools = agentToolsForCapability("canvas-refine");
    expect(tools.map(({ name }) => name)).toEqual(["nomi_canvas_edit"]);
    expect(tools[0]?.schema).toBeDefined();
    expect(canvasWritePiInputSchema.safeParse({ nodeId: "node-a", prompt: "new prompt" }).success).toBe(true);
    expect(canvasToolDescriptors).not.toHaveProperty(CANVAS_WRITE_CAPABILITY.aliases.pi);

    const canvasAgentTools = agentToolsForCapability("canvas-agent");
    expect(canvasAgentTools.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "nomi_canvas_read", "nomi_canvas_plan", "nomi_canvas_edit", "nomi_canvas_maintenance",
    ]));
    expect(canvasDeletePiInputSchema.parse({ nodeIds: ["obsolete-shot"], reason: "Removed by the creator" }))
      .toEqual({ nodeIds: ["obsolete-shot"], reason: "Removed by the creator" });
    expect(tools.map(({ name }) => name)).toEqual(["nomi_canvas_edit"]);

    const policySource = readFileSync(new URL("./agentChatPolicy.ts", import.meta.url), "utf8");
    const descriptorSource = readFileSync(new URL("./tools/canvasDescriptors.ts", import.meta.url), "utf8");
    expect(policySource).not.toContain("canvas.set_node_prompt");
    expect(descriptorSource).not.toContain("set_node_prompt");
    expect(descriptorSource).not.toContain("delete_canvas_nodes");
  });

  it("lets a Skill shrink but never expand the Host capability ceiling", () => {
    const hostTools = agentToolsForCapability("canvas-agent");
    expect(agentToolsForCapabilityAndSkill("canvas-agent", undefined)).toEqual(hostTools);
    const writeAliases = new Set(["nomi_canvas_plan", "nomi_canvas_edit"]);
    expect(agentToolsForCapabilityAndSkill("canvas-agent", [CANVAS_WRITE_CAPABILITY.id]).map(({ name }) => name))
      .toEqual(hostTools.map(({ name }) => name).filter((name) => writeAliases.has(name)));
    expect(agentToolsForCapabilityAndSkill("canvas-refine", [CANVAS_READ_CAPABILITY.id])).toEqual([]);
    expect(() => agentToolsForCapabilityAndSkill("canvas-agent", ["nomi_canvas_read"])).toThrow(
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
    const generationNames = generation.map(({ name }) => name);
    expect(generationNames.slice(0, 4)).toEqual([
      "nomi_canvas_read", "nomi_canvas_plan", "nomi_canvas_edit", "nomi_generation_plan",
    ]);
    // A natural image request uses the semantic Host generation path as well
    // as the canvas projection. Keep this assertion capability-focused rather
    // than coupling it to the exact number/order of future generation tools.
    expect(generationNames).toEqual(expect.arrayContaining([
      "nomi_generation_plan", "nomi_generation_status", "load_skill",
    ]));
    expect(generationNames).not.toEqual(expect.arrayContaining([
      "nomi_request_generation_gate", "nomi_start_generation", "nomi_decide_generation_gate",
    ]));
    expect(generationNames).not.toContain("export_timeline");
    expect(generationNames).not.toContain("start_production_run");
    expect(generation).not.toEqual(agentToolsForCapability("canvas-agent"));

    const timeline = agentToolsForRequest({ capability: "canvas-agent", prompt: "检查时间线并导出" } as never);
    expect(timeline.map(({ name }) => name)).toEqual([
      "nomi_canvas_read",
      "nomi_canvas_plan", "nomi_canvas_edit",
      "get_media", "inspect_media", "search_media", "inspect_source_range", "read_waveform",
      "inspect_export_job", "verify_render", "export_timeline", "cancel_export_job",
      "read_timeline", "inspect_timeline_range", "propose_edit_plan", "apply_edit_plan", "undo_timeline_edit",
      "load_skill",
    ]);
    const timelineSkill = agentToolsForRequest(
      { capability: "canvas-agent", prompt: "检查时间线并导出" } as never,
      ["canvas.read", "asset.read", "timeline.read", "timeline.write", "export.read", "export.write"],
    );
    expect(timelineSkill.map(({ name }) => name)).toEqual([
      "nomi_canvas_read",
      "get_media", "inspect_media", "search_media", "inspect_source_range", "read_waveform",
      "inspect_export_job", "verify_render", "export_timeline", "cancel_export_job",
      "read_timeline", "inspect_timeline_range", "propose_edit_plan", "apply_edit_plan", "undo_timeline_edit",
      "load_skill",
    ]);

    const production = agentToolsForRequest({ capability: "canvas-agent", prompt: "做一个 5 分钟的品牌短片" } as never);
    expect(production.map(({ name }) => name)).toContain("start_production_run");
    expect(production.map(({ name }) => name)).toContain("materialize_production_storyboard");
    expect(agentToolsForRequest(
      { capability: "canvas-agent", prompt: "读取当前成片任务" } as never,
      ["production.run.read"],
    ).map(({ name }) => name)).toEqual([
      "get_production_run", "subscribe_production_run", "read_production_artifact", "read_production_artifact_content", "load_skill",
    ]);
    const productionRequest = { capability: "canvas-agent", prompt: "做一个 5 分钟的品牌短片" } as never;
    expect(agentToolIsInScope(productionRequest, { toolName: "start_production_run", toolCallId: "call-1", args: {} } as never)).toBe(true);
  });

  it("routes a Creation natural-language generation goal to the shared Host tools", () => {
    expect(resolveAgentToolProfile({ capability: "creation-editor", prompt: "帮我生成一个小猫头像" })).toBe("generation");
    const names = agentToolsForRequest({ capability: "creation-editor", prompt: "帮我生成一个小猫头像" } as never).map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining([
      "nomi_generation_plan",
      "nomi_generation_status",
    ]));
    expect(names).not.toContain("nomi_request_generation_gate");
    expect(names).toContain("nomi_document_read");
  });

  it("keeps a Creation prose request document-only", () => {
    expect(resolveAgentToolProfile({ capability: "creation-editor", prompt: "帮我润色这段文案" })).toBe("creation");
    const names = agentToolsForRequest({ capability: "creation-editor", prompt: "帮我润色这段文案" } as never).map(({ name }) => name);
    expect(names).not.toContain("nomi_operation_create");
  });
});
