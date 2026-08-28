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
  it("keeps the legacy conversation files migration-only", () => {
    const main = source("electron/main.ts");
    const preload = source("electron/preload.ts");
    const bridge = source("src/desktop/bridge.ts");
    const app = source("src/workbench/NomiStudioApp.tsx");
    const creationPanel = source("src/workbench/creation/CreationAiPanel.tsx");
    const canvasPanel = source("src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx");

    expect(main).not.toContain("registerConversationsIpc");
    expect(preload).not.toContain("nomi:conversations:");
    expect(bridge).not.toContain("conversations?:");
    expect(app).not.toContain("conversationPersistence");
    expect(creationPanel).not.toContain("conversationPersistence");
    expect(canvasPanel).not.toContain("conversationPersistence");
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
    expect(singleShot).toContain("runWorkbenchAgent");
    expect(singleShot).not.toContain("sendWorkbenchAiMessage");
    expect(exists("src/api/desktopAgentsChatStream.ts")).toBe(false);
    expect(exists("src/workbench/ai/workbenchAiClient.ts")).toBe(false);
  });

  it("keeps both workbench panels as direct Host projections without local transcript owners", () => {
    const app = source("src/workbench/NomiStudioApp.tsx");
    const workbenchStore = source("src/workbench/workbenchStore.ts");
    const canvasStore = source("src/workbench/generationCanvas/store/generationCanvasStore.ts");
    const canvasTypes = source("src/workbench/generationCanvas/store/canvasStoreTypes.ts");
    const creationPanel = source("src/workbench/creation/CreationAiPanel.tsx");
    const canvasPanel = source("src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx");

    expect(app).not.toContain("installProjectAgentSnapshotToUi");
    expect(workbenchStore).not.toContain("creationAiMessages");
    expect(workbenchStore).not.toContain("setCreationAiMessages");
    expect(canvasStore).not.toContain("generationAiMessages");
    expect(canvasTypes).not.toContain("setGenerationAiMessages");
    expect(creationPanel).toContain("useProjectAgentThreadMessages");
    expect(canvasPanel).toContain("useProjectAgentThreadMessages");
    expect(creationPanel).not.toContain("setCreationAiMessages");
    expect(canvasPanel).not.toContain("setGenerationAiMessages");
  });

  it("keeps retired area turn controllers out of the production import graph", () => {
    const productionFiles = [
      "src/workbench/creation/CreationAiPanel.tsx",
      "src/workbench/creation/creationToolCalls.ts",
      "src/workbench/creation/creationAiReplyText.ts",
      "src/workbench/project/projectPersistenceService.ts",
      "src/workbench/project/releaseWorkbenchProjectSession.ts",
      "src/workbench/workbenchStore.ts",
      "src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx",
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
