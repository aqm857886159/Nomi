import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";

const bindingA = {
  projectId: "same-project",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;
const bindingB = {
  ...bindingA,
  immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
} as const;

let root = "";

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("ProjectAgentRepositoryRouter", () => {
  it("creates one host/repository per immutable project partition", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-router-"));
    const router = createProjectAgentRepositoryRouter({ rootDir: root });

    const hostA = router.attach(bindingA);
    expect(router.attach(bindingA)).toBe(hostA);
    expect(router.partitionCount()).toBe(1);

    const hostB = router.attach(bindingB);
    expect(hostB).not.toBe(hostA);
    expect(router.partitionCount()).toBe(2);
    expect(router.repositoryFor(bindingA)).not.toBe(router.repositoryFor(bindingB));
  });
});
