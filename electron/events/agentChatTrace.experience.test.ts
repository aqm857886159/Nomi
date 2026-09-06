import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEvents, setEventLogProjectDirResolverForTests } from "./eventLogRepository";
import { beginTurnTrace, traceChatEvent } from "./agentChatTrace";
import { createProjectAgentContextBinding } from "../shared/contracts/projectAgentContextBinding";

let root = "";

afterEach(() => {
  setEventLogProjectDirResolverForTests(() => null);
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("legacy agent trace experience boundary", () => {
  it("keeps legacy trace telemetry-only; canonical Host owns experience completion", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-legacy-agent-trace-"));
    setEventLogProjectDirResolverForTests(() => root);
    beginTurnTrace("legacy-session", {
      history: {
        kind: "persistent",
        binding: createProjectAgentContextBinding(
          { projectId: "project-a", immutableProjectUuid: "4d80f2e0-4a45-4a8f-8fe1-78ac659177c8", projectGeneration: 1 },
          "thread-1",
        ),
      },
      prompt: "旧链路不应沉淀经验",
    });
    traceChatEvent("legacy-session", {
      type: "result",
      result: { status: "finished", text: "done", usage: {} },
    });

    expect(readEvents("project-a").map((event) => event.type)).toContain("agent.turn.finished");
    expect(readEvents("project-a").map((event) => event.type)).not.toContain("experience.candidate.created");
  });
});
