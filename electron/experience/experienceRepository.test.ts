import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setEventLogProjectDirResolverForTests, readEvents } from "../events/eventLogRepository";
import { createExperienceRepository, setExperienceProjectDirResolverForTests } from "./experienceRepository";
import { getProjectMemory, setProjectMemoryDirResolverForTests } from "../memory/projectMemory";

const roots: string[] = [];
afterEach(() => {
  setEventLogProjectDirResolverForTests(() => null);
  setExperienceProjectDirResolverForTests(() => null);
  setProjectMemoryDirResolverForTests(() => null);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-experience-"));
  roots.push(root);
  setEventLogProjectDirResolverForTests(() => root);
  setExperienceProjectDirResolverForTests(() => root);
  setProjectMemoryDirResolverForTests(() => root);
  return root;
}

const trajectory = {
  trajectoryId: "traj-1",
  projectId: "p1",
  sessionId: "s1",
  prompt: "修复接入",
  response: "<!-- nomi-learning {\"kind\":\"procedure\",\"title\":\"先跑契约\",\"content\":\"先验证再沉淀\",\"evidence\":{\"problem\":\"列表为空\",\"action\":\"补认证\",\"outcome\":\"列表恢复\",\"verification\":\"测试通过\",\"eventSeqs\":[1]},\"confidence\":0.9} -->",
  events: [],
  completedAt: "2026-09-02T00:00:00.000Z",
} as const;

describe("experience repository", () => {
  it("persists candidates as an event-backed projection and is idempotent", async () => {
    setup();
    const repo = createExperienceRepository();
    const first = await repo.complete(trajectory);
    const second = await repo.complete(trajectory);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].candidateId).toBe(first[0].candidateId);
    expect(readEvents("p1").filter((event) => event.type === "experience.candidate.created")).toHaveLength(1);
  });

  it("rebuilds a corrupt projection from the event log", async () => {
    const root = setup();
    const repo = createExperienceRepository();
    await repo.complete(trajectory);
    const file = path.join(root, ".nomi", "experience", "index.json");
    fs.writeFileSync(file, "not-json", "utf8");
    const rebuilt = createExperienceRepository().list("p1");
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].title).toBe("先跑契约");
  });

  it("records reuse and promotion without deleting the original candidate event", async () => {
    setup();
    const repo = createExperienceRepository();
    const [candidate] = await repo.complete(trajectory);
    await repo.recordReuse("p1", candidate.candidateId, { trajectoryId: "traj-2", verified: true });
    const promoted = await repo.recordReuse("p1", candidate.candidateId, { trajectoryId: "traj-3", verified: true });
    expect(promoted?.status).toBe("active");
    expect(readEvents("p1").some((event) => event.type === "experience.reuse.recorded")).toBe(true);
    expect(readEvents("p1").some((event) => event.type === "experience.candidate.created")).toBe(true);
  });

  it("projects an active green fact through the existing project memory boundary", async () => {
    setup();
    const repo = createExperienceRepository();
    const factTrajectory = {
      ...trajectory,
      trajectoryId: "fact-traj-1",
      response: "<!-- nomi-learning {\"kind\":\"fact\",\"title\":\"凭据边界\",\"content\":\"API key 只留在本机\",\"evidence\":{\"problem\":\"担心泄露\",\"action\":\"使用主进程密钥边界\",\"outcome\":\"凭据未离开本机\",\"verification\":\"日志未出现密钥\",\"eventSeqs\":[1]},\"confidence\":0.95} -->",
    };
    await repo.complete(factTrajectory);
    expect(getProjectMemory("p1").facts.map((fact) => fact.text)).toContain("API key 只留在本机");
  });
});
