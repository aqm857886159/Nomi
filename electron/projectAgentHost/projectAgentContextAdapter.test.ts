import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readProjectAgentLegacyContext } from "./projectAgentLegacyContextReader";
import {
  legacyContextRecordKey,
  projectAgentContextPath,
  stageProjectAgentLegacyContext,
} from "./projectAgentContextAdapter";

const binding = {
  projectId: "context-adapter-project",
  immutableProjectUuid: "33333333-3333-4333-8333-333333333333",
  projectGeneration: 2,
} as const;
let root = "";

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

function writeContext(value: unknown): void {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-context-adapter-"));
  fs.mkdirSync(path.join(root, ".nomi"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".nomi", "agent-session.json"),
    JSON.stringify({
      sessions: {
        "nomi:workbench:context-adapter-project:creation": value,
      },
    }),
    "utf8",
  );
}

describe("ProjectAgent legacy context adapter", () => {
  it("stages an exact validated snapshot into an area-free binding", () => {
    writeContext({ threadId: "legacy-thread", snapshot: "opaque-v1" });
    const source = readProjectAgentLegacyContext(root);
    const first = stageProjectAgentLegacyContext({
      projectRoot: root,
      binding,
      source,
      candidates: [
        {
          area: "creation",
          legacyThreadId: "legacy-thread",
          threadId: "canonical-thread",
          conversationSourceHash: "a".repeat(64),
        },
      ],
    });
    expect(first.recordIds.get(legacyContextRecordKey("creation", "legacy-thread"))).toMatch(/^context-[a-f0-9]{64}$/);
    const raw = JSON.parse(fs.readFileSync(projectAgentContextPath(root), "utf8")) as {
      binding: { projectId: string };
      records: Array<{ binding: { sessionKey: string }; source: { legacyArea: string }; snapshot: unknown }>;
    };
    expect(raw.binding.projectId).toBe(binding.projectId);
    expect(raw.records[0]).toMatchObject({
      binding: { sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g2`, threadId: "canonical-thread" },
      source: { legacyArea: "creation", legacyThreadId: "legacy-thread" },
      snapshot: { threadId: "legacy-thread", snapshot: "opaque-v1" },
    });
  });

  it("does not stage an invalid snapshot and is idempotent for the same source", () => {
    writeContext({ arbitrary: true });
    const source = readProjectAgentLegacyContext(root);
    const input = {
      projectRoot: root,
      binding,
      source,
      candidates: [
        {
          area: "creation" as const,
          legacyThreadId: "legacy-thread",
          threadId: "canonical-thread",
          conversationSourceHash: "b".repeat(64),
        },
      ],
    };
    const first = stageProjectAgentLegacyContext(input);
    const second = stageProjectAgentLegacyContext(input);
    expect(first.recordIds.size).toBe(0);
    expect(second.recordIds.size).toBe(0);
    expect(JSON.parse(fs.readFileSync(projectAgentContextPath(root), "utf8")).records).toEqual([]);
  });

  it("rejects duplicate candidates and a changed binding after staging", () => {
    writeContext({ threadId: "legacy-thread", snapshot: "opaque-v1" });
    const source = readProjectAgentLegacyContext(root);
    const candidate = {
      area: "creation" as const,
      legacyThreadId: "legacy-thread",
      threadId: "canonical-thread",
      conversationSourceHash: "c".repeat(64),
    };
    expect(() =>
      stageProjectAgentLegacyContext({ projectRoot: root, binding, source, candidates: [candidate, candidate] }),
    ).toThrow(/Duplicate legacy context candidate/);
    stageProjectAgentLegacyContext({ projectRoot: root, binding, source, candidates: [candidate] });
    expect(() =>
      stageProjectAgentLegacyContext({
        projectRoot: root,
        binding: { ...binding, projectGeneration: 3 },
        source,
        candidates: [candidate],
      }),
    ).toThrow(/Legacy context staging changed/);
  });

  it("fails closed when an existing staging record is rebound to another project", () => {
    writeContext({ threadId: "legacy-thread", snapshot: "opaque-v1" });
    const source = readProjectAgentLegacyContext(root);
    const candidate = {
      area: "creation" as const,
      legacyThreadId: "legacy-thread",
      threadId: "canonical-thread",
      conversationSourceHash: "d".repeat(64),
    };
    stageProjectAgentLegacyContext({ projectRoot: root, binding, source, candidates: [candidate] });
    const stagingPath = projectAgentContextPath(root);
    const staging = JSON.parse(fs.readFileSync(stagingPath, "utf8")) as {
      records: Array<{ binding: { project: { projectId: string } } }>;
    };
    staging.records[0]!.binding.project.projectId = "other-project";
    fs.writeFileSync(stagingPath, JSON.stringify(staging), "utf8");
    expect(() =>
      stageProjectAgentLegacyContext({ projectRoot: root, binding, source, candidates: [candidate] }),
    ).toThrow(/staging envelope is invalid/);
  });
});
