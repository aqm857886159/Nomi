import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEvents, setEventLogProjectDirResolverForTests } from "../events/eventLogRepository";
import type { AgentChatRequest, AgentChatResponse } from "../harness/agentChatContracts";
import { createProjectAgentContextBinding } from "../projectAgentHost/projectAgentContextBinding";
import type { ProjectAgentHostState, ProjectAgentTurn } from "../shared/projectAgentContracts";
import { resetExperienceRepositoryForTests, setExperienceProjectDirResolverForTests, getExperienceRepository } from "./experienceRepository";
import { completeProjectAgentExperience } from "./projectAgentExperience";

let root = "";

afterEach(() => {
  setEventLogProjectDirResolverForTests(() => null);
  setExperienceProjectDirResolverForTests(() => null);
  resetExperienceRepositoryForTests();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("canonical ProjectAgentHost experience completion", () => {
  it("writes the terminal Host receipt before extracting an explicit envelope", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-canonical-experience-"));
    setEventLogProjectDirResolverForTests(() => root);
    setExperienceProjectDirResolverForTests(() => root);
    const binding = {
      projectId: "project-a",
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 1,
    } as const;
    const turn: ProjectAgentTurn = {
      turnId: "turn-1",
      threadId: "thread-1",
      executionToken: "token-1",
      model: { id: "model", version: 1 },
      skillVersions: [],
      capabilityVersions: [],
      contextRef: {
        binding: createProjectAgentContextBinding(binding, "thread-1"),
        contextRevision: 0,
        recordId: "context-1",
      },
      status: "done",
      retryable: false,
      deviated: false,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:01.000Z",
    };
    const state: ProjectAgentHostState = {
      binding,
      hostRevision: 2,
      commandLedgerHighWater: 2,
      activeThreadId: "thread-1",
      threads: [],
      turns: [turn],
      items: [],
      queue: [],
      proposalApprovals: [],
      recentAppliedCommands: [],
    };
    const request = {
      prompt: "修复供应商接入",
      history: { kind: "ephemeral" },
    } as AgentChatRequest;
    const response = {
      id: "response-1",
      status: "finished",
      text: "<!-- nomi-learning {\"kind\":\"fact\",\"title\":\"本地凭据边界\",\"content\":\"凭据只留在本机\",\"evidence\":{\"problem\":\"担心泄露\",\"action\":\"使用主进程密钥边界\",\"outcome\":\"凭据未离开本机\",\"verification\":\"终态事件已落盘\",\"eventSeqs\":[1]},\"confidence\":0.95} -->",
      finishReason: "stop",
      artifacts: [],
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 2 },
    } as AgentChatResponse;

    await completeProjectAgentExperience({
      binding,
      turnId: turn.turnId,
      executionToken: turn.executionToken,
      request,
      response,
      state,
      completedAt: turn.updatedAt,
    });

    expect(readEvents(binding.projectId).map((event) => event.type)).toEqual([
      "agent.turn.finished",
      "experience.candidate.created",
    ]);
    expect(getExperienceRepository().list(binding.projectId)[0]).toMatchObject({
      kind: "fact",
      status: "active",
      eligibleForPrompt: true,
      evidence: { eventSeqs: [1] },
    });
  });
});
