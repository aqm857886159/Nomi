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
});
