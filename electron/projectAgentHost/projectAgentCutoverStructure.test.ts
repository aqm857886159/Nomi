import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("Project Agent production cutover structure", () => {
  it("keeps the legacy conversation files migration-only", () => {
    const main = source("electron/main.ts");
    const preload = source("electron/preload.ts");
    const app = source("src/workbench/NomiStudioApp.tsx");
    const creationPanel = source("src/workbench/creation/CreationAiPanel.tsx");
    const canvasPanel = source("src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx");

    expect(main).not.toContain("registerConversationsIpc");
    expect(preload).not.toContain("nomi:conversations:");
    expect(app).not.toContain("conversationPersistence");
    expect(creationPanel).not.toContain("conversationPersistence");
    expect(canvasPanel).not.toContain("conversationPersistence");
  });
});
