import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(process.cwd(), relativePath));
}

describe("Project Agent production cutover structure", () => {
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
    const runner = source("src/workbench/ai/workbenchAgentRunner.ts");
    const singleShot = source("src/workbench/ai/agentLoopMode.ts");

    expect(main).not.toContain("registerAgentChatV2Ipc");
    expect(preload).not.toContain("nomi:agents:chatV2");
    expect(bridge).not.toMatch(/\bagents\s*:/);
    expect(runner).not.toContain("desktopAgentsChatStream");
    // 这条钉的是「single-shot 也走 Host 传输，不回退到旧的 chatV2 渲染层通道」。
    // 2026-09-05 起它走 Host 的**临时执行路**（projectAgentClient.runEphemeral）而不是回合流水线，
    // 所以判据从「含 runWorkbenchAgent」改成「含 Host 客户端」——不变的仍是「不碰旧通道」。
    expect(singleShot).toContain("projectAgentClient");
    expect(singleShot).not.toContain("sendWorkbenchAiMessage");
    expect(singleShot).not.toContain("desktopAgentsChatStream");
    expect(exists("src/api/desktopAgentsChatStream.ts")).toBe(false);
    expect(exists("src/workbench/ai/workbenchAiClient.ts")).toBe(false);
  });

  it("keeps the resident shell as the only Host projection without local transcript owners", () => {
    const app = source("src/workbench/NomiStudioApp.tsx");
    const workbenchStore = source("src/workbench/workbenchStore.ts");
    const residentShell = source("src/workbench/ai/ProjectAgentResidentShell.tsx");
    const workbenchShell = source("src/workbench/WorkbenchShell.tsx");

    expect(app).not.toContain("installProjectAgentSnapshotToUi");
    expect(workbenchStore).not.toContain("creationAiMessages");
    expect(workbenchStore).not.toContain("setCreationAiMessages");
    expect(residentShell).toContain("useProjectAgentSnapshot");
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
    const animationsCss = source("src/styles/animations.css");

    expect(exists("src/workbench/workbench-ai.css")).toBe(false);
    expect(shell).not.toContain("workbench-ai.css");
    expect(workbenchCss).toContain(".workbench-editor__scroll");
    expect(workbenchCss).toContain(".workbench-autogrow");
    expect(workbenchCss).not.toContain("tc-ai-chat");
    expect(animationsCss).not.toContain("tc-ai-chat");
  });

  it("keeps retired area turn controllers out of the production import graph", () => {
    const productionFiles = [
      "src/workbench/creation/creationToolCalls.ts",
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

  it("hydrates proposal receipts only after the current project epoch and Host projection are installed", () => {
    const app = source("src/workbench/NomiStudioApp.tsx");
    const preload = source("electron/preload.ts");
    const open = app.indexOf("await projectAgentClient.open(committedBinding.binding)");
    const currentGuard = app.indexOf("surfaceEpoch.assertCurrent()", open);
    const install = app.indexOf("projectAgentProjectionStore.install", currentGuard);
    const hydrate = app.indexOf("hydrateCommittedProposalReceipt(opened.proposalReceipt)", install);

    expect(open).toBeGreaterThan(-1);
    expect(currentGuard).toBeGreaterThan(open);
    expect(install).toBeGreaterThan(currentGuard);
    expect(hydrate).toBeGreaterThan(install);
    expect(preload).toContain("nomi:projectAgent:proposalReceipt:read");
    expect(preload).toContain("nomi:projectAgent:proposalReceipt:write");
    expect(preload).toContain("nomi:projectAgent:proposalReceipt:clear");
    expect(preload).not.toContain("projectRoot: proposal");
    expect(preload).not.toContain("sourceHash: proposal");
  });
});
