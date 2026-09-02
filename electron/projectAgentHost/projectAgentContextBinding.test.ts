import { describe, expect, it } from "vitest";

import {
  ProjectAgentContextBindingError,
  assertProjectAgentContextBinding,
  createProjectAgentContextBinding,
  deriveProjectAgentSessionKey,
} from "./projectAgentContextBinding";

const PROJECT = {
  projectId: "project-shared-name",
  immutableProjectUuid: "4d80f2e0-4a45-4a8f-8fe1-78ac659177c8",
  projectGeneration: 3,
};

describe("ProjectAgentContextBinding", () => {
  it("derives one area-free project session key from immutable identity", () => {
    expect(deriveProjectAgentSessionKey(PROJECT)).toBe("nomi:project-agent:4d80f2e0-4a45-4a8f-8fe1-78ac659177c8:g3");
    expect(createProjectAgentContextBinding(PROJECT, "thread-main")).toEqual({
      project: PROJECT,
      threadId: "thread-main",
      sessionKey: "nomi:project-agent:4d80f2e0-4a45-4a8f-8fe1-78ac659177c8:g3",
    });
  });

  it("does not reuse a context across immutable UUID or generation changes", () => {
    expect(deriveProjectAgentSessionKey({ ...PROJECT, projectGeneration: 4 })).not.toBe(
      deriveProjectAgentSessionKey(PROJECT),
    );
    expect(
      deriveProjectAgentSessionKey({
        ...PROJECT,
        immutableProjectUuid: "7fc71ab7-2be1-4ed5-9c6d-95c444284389",
      }),
    ).not.toBe(deriveProjectAgentSessionKey(PROJECT));
  });

  it("rejects a caller-supplied legacy area key or mismatched project identity", () => {
    expect(() =>
      assertProjectAgentContextBinding({
        project: PROJECT,
        threadId: "thread-main",
        sessionKey: "nomi:creation:project-shared-name:thread-main",
      }),
    ).toThrow(ProjectAgentContextBindingError);

    expect(() =>
      assertProjectAgentContextBinding({
        project: PROJECT,
        threadId: "thread-main",
        sessionKey: "nomi:project-agent:7fc71ab7-2be1-4ed5-9c6d-95c444284389:g3",
      }),
    ).toThrow(/session key/i);
    expect(() =>
      assertProjectAgentContextBinding({
        project: PROJECT,
        threadId: " thread-main ",
        sessionKey: deriveProjectAgentSessionKey(PROJECT),
      }),
    ).toThrow(/thread/i);
  });

  it("rejects empty thread ids and unsafe identity components", () => {
    expect(() => createProjectAgentContextBinding(PROJECT, " ")).toThrow(/thread/i);
    expect(() => createProjectAgentContextBinding(PROJECT, " thread-main ")).toThrow(/thread/i);
    expect(() => deriveProjectAgentSessionKey({ ...PROJECT, immutableProjectUuid: "../project" })).toThrow(
      ProjectAgentContextBindingError,
    );
    expect(() => deriveProjectAgentSessionKey({ ...PROJECT, immutableProjectUuid: "project-not-a-uuid" })).toThrow(
      ProjectAgentContextBindingError,
    );
    expect(() =>
      deriveProjectAgentSessionKey({
        ...PROJECT,
        immutableProjectUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      }),
    ).toThrow(ProjectAgentContextBindingError);
    expect(() => deriveProjectAgentSessionKey({ ...PROJECT, projectGeneration: 0 })).toThrow(
      ProjectAgentContextBindingError,
    );
    expect(() =>
      deriveProjectAgentSessionKey({
        ...PROJECT,
        immutableProjectUuid: PROJECT.immutableProjectUuid.toUpperCase(),
      }),
    ).toThrow(ProjectAgentContextBindingError);
    expect(() => deriveProjectAgentSessionKey({ ...PROJECT, projectId: " project-shared-name " })).toThrow(
      ProjectAgentContextBindingError,
    );
  });

  it("returns a frozen canonical copy instead of caller-owned objects", () => {
    const callerOwned = {
      project: { ...PROJECT },
      threadId: "thread-main",
      sessionKey: deriveProjectAgentSessionKey(PROJECT),
    };

    const canonical = assertProjectAgentContextBinding(callerOwned);
    callerOwned.project.projectId = "attacker-mutated";
    callerOwned.threadId = "attacker-mutated";

    expect(canonical).toEqual({
      project: PROJECT,
      threadId: "thread-main",
      sessionKey: deriveProjectAgentSessionKey(PROJECT),
    });
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(Object.isFrozen(canonical.project)).toBe(true);

    const created = createProjectAgentContextBinding(PROJECT, "thread-main");
    expect(created.project.projectId).toBe("project-shared-name");
    expect(created.threadId).toBe("thread-main");
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.project)).toBe(true);
  });

  it("rejects extra identity fields instead of silently normalizing them away", () => {
    expect(() =>
      createProjectAgentContextBinding({ ...PROJECT, area: "generation" } as typeof PROJECT, "thread-main"),
    ).toThrow(ProjectAgentContextBindingError);
    expect(() =>
      assertProjectAgentContextBinding({
        project: PROJECT,
        threadId: "thread-main",
        sessionKey: deriveProjectAgentSessionKey(PROJECT),
        legacyArea: "creation",
      }),
    ).toThrow(ProjectAgentContextBindingError);
  });
});
