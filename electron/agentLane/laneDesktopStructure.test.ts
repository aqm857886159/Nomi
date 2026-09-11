import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(process.cwd(), relativePath));
}

describe("Agent lane production cutover structure", () => {
  it("removes the legacy conversation shells after Host cutover", () => {
    const main = source("electron/main.ts");
    const preload = source("electron/preload.ts");
    const bridge = source("src/desktop/bridge.ts");
    const app = source("src/workbench/NomiStudioApp.tsx");

    expect(main).not.toContain("registerConversationsIpc");
    expect(preload).not.toContain("nomi:conversations:");
    expect(bridge).not.toContain("conversations?:");
    expect(app).not.toContain("conversationPersistence");
    expect(exists("src/workbench/creation/CreationAiPanel.tsx")).toBe(false);
    expect(exists("src/workbench/generationCanvas/components/CanvasAssistantEntry.tsx")).toBe(false);
    expect(exists("src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx")).toBe(false);
    expect(exists("src/workbench/generationCanvas/store/generationAiConversation.ts")).toBe(false);
    expect(exists("src/workbench/aiConversationBuckets.ts")).toBe(false);
    expect(exists("src/workbench/ai/conversationPersistence.ts")).toBe(false);
    expect(exists("src/workbench/ai/conversationThreads.ts")).toBe(false);
  });

  it("keeps the legacy chatV2 renderer transport outside the production graph", () => {
    const main = source("electron/main.ts");
    const preload = source("electron/preload.ts");
    const bridge = source("src/desktop/bridge.ts");
    const singleShot = source("src/workbench/ai/agentLoopMode.ts");

    expect(main).not.toContain("registerAgentChatV2Ipc");
    expect(preload).not.toContain("nomi:agents:chatV2");
    expect(bridge).not.toMatch(/\bagents\s*:/);
    expect(exists("src/workbench/ai/workbenchAgentRunner.ts")).toBe(false);
    expect(singleShot).toContain("laneClient.singleShot");
    expect(singleShot).not.toContain("sendWorkbenchAiMessage");
    expect(exists("src/api/desktopAgentsChatStream.ts")).toBe(false);
    expect(exists("src/workbench/ai/workbenchAiClient.ts")).toBe(false);
  });

  it("keeps the resident shell on one lane projection without local transcript owners", () => {
    const app = source("src/workbench/NomiStudioApp.tsx");
    const workbenchStore = source("src/workbench/workbenchStore.ts");
    const residentShell = source("src/workbench/ai/ProjectAgentResidentShell.tsx");
    const residentData = source("src/workbench/ai/v4/useAgentPanelV4Data.ts");
    const workbenchShell = source("src/workbench/WorkbenchShell.tsx");

    expect(app).not.toContain("installProjectAgentSnapshotToUi");
    expect(workbenchStore).not.toContain("creationAiMessages");
    expect(workbenchStore).not.toContain("setCreationAiMessages");
    // 「宿主投影只有一个入口」这条不变量没变，位置变了：v4 接线把读侧收进
    // `useAgentPanelV4Data`，容器只消费它。断言跟着真正读快照的那个模块走，
    // 否则它就变成一条量不到东西的死断言（`dead-selector-lies-both-ways`）。
    expect(residentData).toContain("useSyncExternalStore(laneClient.subscribe, laneClient.workspace, laneClient.workspace)");
    expect(residentData).not.toContain("useProjectAgentSnapshot");
    expect(residentShell).toContain("useAgentPanelV4Data");
    expect(residentShell).not.toContain("useProjectAgentSnapshot");
    expect(residentShell).toContain("projectAgentDraft");
    expect(workbenchShell).toContain("createPortal(<ProjectAgentResidentShell surface={agentSurface} />, agentDock)");
    expect(workbenchStore).not.toContain("creationAiDraft");
  });

  // C9 (开闸红灯 · 共存期裁决 2026-09-01)：generationAi* 画布态被拆解面板 v1（DeconstructionPanelHost /
  // NodeDeconstructionPanel / CollapsedAiChip，主线 #293/#295）依赖为活功能——CollapsedAiChip 读
  // generationAiCollapsed + generationAiMessages.length，拆解面板与 AI 栏过渡期互斥（R-C-1）同占右槽。
  // 编排者裁决「功能连续性优先」：M1 保留 generationAi* 与旧面板共存，cutover 的这三条删除断言迁为开闸条件。
  // 开闸通过条件见 docs/qa/2026-09-01-agent-m0-red-lights.md 的 C9 节：删旧 composer 态 / CreationAiPanel、
  // 拆解 handoff 改接 Host 投影 draft 后，这三条断言转绿即可解除 skip。
  it.skip("[C9 gate] removes generationAi* canvas transcript owners after deconstruction handoff to Host projection", () => {
    const canvasStore = source("src/workbench/generationCanvas/store/generationCanvasStore.ts");
    const canvasTypes = source("src/workbench/generationCanvas/store/canvasStoreTypes.ts");

    expect(canvasStore).not.toContain("generationAiMessages");
    expect(canvasTypes).not.toContain("setGenerationAiMessages");
    expect(canvasTypes).not.toContain("generationAiDraft");
  });

  it("removes the retired chat stylesheet without regressing live workbench scrolling", () => {
    const shell = source("src/workbench/WorkbenchShell.tsx");
    const workbenchCss = source("src/workbench/workbench.css");

    expect(exists("src/workbench/workbench-ai.css")).toBe(false);
    expect(shell).not.toContain("workbench-ai.css");
    expect(workbenchCss).toContain(".workbench-editor__scroll");
    expect(workbenchCss).toContain(".workbench-autogrow");
    expect(workbenchCss).not.toContain("tc-ai-chat");
    // src/styles/animations.css 已整体删除（从不在 main.tsx 的 import 图里，@apply 的
    // animate-shimmer/animate-sheen 在 tailwind.config.ts 里根本没定义 → 死码）。
    // 断言跟着「文件不存在」走，别留一条 readFileSync 会直接抛的死断言。
    expect(exists("src/styles/animations.css")).toBe(false);
  });

  it("keeps retired area turn controllers out of the production import graph", () => {
    // 2026-09-11: both controllers were deleted outright (zero production references
    // left; canvasTurnController's only non-guard consumer was a test, migrated to a
    // local turn store). The import-graph check stays as a no-reintroduction guard;
    // the exists() checks below are what keep this test from going vacuous now that
    // the files themselves are gone.
    expect(exists("src/workbench/generationCanvas/agent/canvasTurnController.ts")).toBe(false);
    expect(exists("src/workbench/creation/creationTurnController.ts")).toBe(false);

    const productionFiles = [
      "src/workbench/creation/creationAiReplyText.ts",
      "src/workbench/project/projectPersistenceService.ts",
      "src/workbench/project/releaseWorkbenchProjectSession.ts",
      "src/workbench/workbenchStore.ts",
      "src/workbench/ai/ProjectAgentResidentShell.tsx",
    ];

    for (const file of productionFiles) {
      expect(source(file)).not.toMatch(/(?:from|import\()\s*['"].*(?:creationTurnController|canvasTurnController)['"]|require\(\s*['"].*(?:creationTurnController|canvasTurnController)['"]\s*\)/);
    }
  });

  it("hydrates proposal receipts only after the current lane workspace is installed", () => {
    const app = source("src/workbench/NomiStudioApp.tsx");
    const preload = source("electron/preload.ts");
    const open = app.indexOf("await laneClient.open(committedBinding.binding)");
    const currentGuard = app.indexOf("surfaceEpoch.assertCurrent()", open);
    const hydrate = app.indexOf("hydrateCommittedProposalReceipt(await laneReceiptClient.readProposalReceipt(opened.workspaceId))", currentGuard);

    expect(open).toBeGreaterThan(-1);
    expect(currentGuard).toBeGreaterThan(open);
    expect(hydrate).toBeGreaterThan(currentGuard);
    expect(preload).toContain("LANE_IPC_CHANNELS.command");
    expect(preload).not.toContain("nomi:projectAgent:");
    expect(preload).not.toContain("projectRoot: proposal");
    expect(preload).not.toContain("sourceHash: proposal");
  });
});

describe("回复语言跟界面语言走：lane 的身份提示词不许是开 lane 那一刻的快照（2026-09-11 走查）", () => {
  // 真机现象：用户在设置里把界面切成 English 后，同一个项目里连开新对话，助手仍整段中文——
  // 只有冷启动才生效。根因是 `systemPrompt` 是**字符串快照**，而 lane 会跨很多回合活着。
  // 端到端的证明在真机走查；这里钉住结构：宿主必须能拿到「现在的」那一段，且每回合重新求值。
  it("port 允许传函数，laneHost 每回合重新拼，桌面运行时传的就是函数", () => {
    const port = source("electron/agentLane/laneRuntimePort.ts");
    const host = source("electron/agentLane/laneHost.mts");
    const runtime = source("electron/agentLane/laneDesktopRuntime.ts");

    expect(port).toContain("systemPrompt: string | (() => string)");
    // transform_context 每个回合都跑一次——它必须调 composeSystemPrompt()，不是引用开 lane 时的常量。
    const transform = host.slice(host.indexOf("harness.hooks.on('transform_context'"), host.indexOf("harness.hooks.on('before_tool'"));
    expect(transform).toContain("composeSystemPrompt()");
    expect(transform).not.toMatch(/\{\s*systemPrompt:\s*\[systemPrompt,/);
    // 桌面运行时：语言铁律必须在函数体里（每次求值都重读 locale），不是先算好再传。
    expect(runtime).toContain("systemPrompt: () => [buildLanguageRule()");
  });
});
