/**
 * 给 Agent 的模型清单带着新约束形状 `when: { slotEmpty }` 也要过两道边界校验（2026-11-14）：
 *   · 画布面板 → 主进程的 composer 上下文（laneDesktopInput.parseLaneComposerContext 的 availableModels）；
 *   · list_models 的输出校验（readVerbs 的 outputSchema）。
 * 两道都是严格 zod：只认 `{ key, value }` 时，可灵 4.0 Flash 一条约束就让**整张清单**解析失败，Agent 一个模型都看不到。
 * 清单用真实目录投影（agentModelEntriesFromCatalog，内置种子），不手写条目。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("../../parity/parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "nomi-agent-slot-empty-")));
});

import { applyBuiltinSeeds } from "../../catalog/seedBuiltins";
import { agentModelEntriesFromCatalog } from "../../catalog/agentModelEntriesFromCatalog";
import { parseLaneComposerContext } from "../../agentLane/laneDesktopInput";
import { readVerbs } from "./verbs/readVerbs";
import { PROJECT_AGENT_APPROVAL_MODES } from "./capabilityApprovalPolicy";

const state = applyBuiltinSeeds({ version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-11-14").state;
const models = agentModelEntriesFromCatalog(state).map((row) => row.entry);

describe("Agent 模型清单带 slotEmpty 约束照常过边界校验", () => {
  it("前提：清单里可灵 4.0 Flash 全能参考的声音带着 slotEmpty 约束", () => {
    const kling = models.find((entry) => entry.modelId === "kling-v4-flash");
    const audio = kling?.modes.find((mode) => mode.modeId === "ref")?.params.find((param) => param.key === "audio_setting");
    expect(audio?.optionConstraints).toEqual([{ when: { slotEmpty: "video_ref" }, values: ["auto"] }]);
  });

  it("composer 上下文（laneDesktopInput）解析带这条约束的清单（取视频模型，整张会超这道边界自己的 256 KB 上限）", () => {
    const videos = models.filter((entry) => entry.kind === "video" && entry.vendor === "apimart");
    expect(videos.some((entry) => entry.modelId === "kling-v4-flash")).toBe(true);
    const parsed = parseLaneComposerContext({ approvalPolicy: { mode: PROJECT_AGENT_APPROVAL_MODES[0] }, availableModels: videos });
    expect(parsed.availableModels).toHaveLength(videos.length);
  });

  it("list_models 输出校验通过整张清单", () => {
    const listModels = readVerbs().find((verb) => verb.name === "list_models")!;
    expect(() => listModels.outputSchema!.parse({ models })).not.toThrow();
  });
});
