import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { createProductionGenerationSubmission, type ProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";

// 架构③ 合同 2（协调会话 10-08）：单镜与多镜走**同一个**「镜头落地」准入点，不各写一份。
//
// 三层证据，强到弱：
//   ① 类型：提交出口 `submission.start` 必须拿到一份「已落地」准入（只有准入函数造得出来）——不经准入的调用编译不过；
//   ② 运行时：提交出口在第一笔耐久写之前自己按耐久 Run 复核这份准入（节点绑着、没被拿走），伪造 / 过期的准入照样拒；
//   ③ 结构：派发口只剩准入函数的调用者；「尽力预落地」那一份（landCanvasBestEffort）从开拍路径上删掉。

const NOW = "2026-10-08T00:00:00.000Z";
const PROJECT = "project-1";
const RUN = "op-one-admission";
const roots: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text"], outputKinds: ["image"], modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } }, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "fixture-provider", models: [{ modelId: "fixture-model", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
}]);

const candidate = (): PlanCandidate => ({
  candidateId: "candidate-1", revision: 1, moduleId: "generation.single-shot", providerId: "fixture-provider", modelId: "fixture-model",
  mode: "text-to-image", prompt: "A paper boat", parameters: { aspectRatio: "16:9" }, references: [],
});

function setupUnlanded(submit: ReturnType<typeof vi.fn>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-one-admission-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === PROJECT ? root : null), now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const planCandidate = candidate();
  const contract = compileExecutionContract(planCandidate, registry);
  repository.createGenerationDraft({
    operationId: RUN, projectId: PROJECT, origin: { host: "nomi" }, candidate: planCandidate,
    policy: { trustedHosts: ["nomi"], allowedProviders: ["fixture-provider"], allowedModels: ["fixture-model"], maxSpend: 0, maxAttemptsPerJob: 2 },
  });
  const provider: GenerationProvider = {
    providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (input) => input, submit: submit as unknown as GenerationProvider["submit"],
  };
  sealAndApproveProductionGeneration({
    repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: planCandidate, contract, providers: [provider], now: NOW,
  });
  const submission = createProductionGenerationSubmission({
    repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    intentMacKey: "test-intent-key", provider, now: () => NOW,
  });
  return { repository, submission };
}

/** 只给类型检查看（check:test-types）：不经准入就开拍，必须编译不过。永不运行。 */
export function startWithoutAdmissionDoesNotCompile(submission: ProductionGenerationSubmission): void {
  // @ts-expect-error — `submission.start` 没有「已落地」准入就不许调（合同 2：唯一准入点）
  void submission.start({ projectId: PROJECT, operationId: RUN });
}

const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

function productionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(relative); continue; }
      if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|TestUtils\.ts$|\.e2e\.test\.ts$/.test(entry.name)) out.push(relative);
    }
  };
  walk("electron");
  return out;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("one land-first admission for every production dispatch", () => {
  it("runtime backstop: the submission exit refuses a shot with no landed node before any durable write or provider call", async () => {
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const { repository, submission } = setupUnlanded(submit);
    const before = repository.read(PROJECT, RUN)!;
    // 伪造一份准入：Run 里这一镜根本没有节点绑定。提交出口必须按耐久 Run 复核，而不是信调用方。
    const forged = { projectId: PROJECT, runId: RUN, shotId: "candidate-1", nodeId: "node-made-up" };

    await expect(submission.start({ projectId: PROJECT, operationId: RUN, admission: forged } as never))
      .rejects.toMatchObject({ code: "shot_not_landed" });

    expect(submit).not.toHaveBeenCalled();
    const after = repository.read(PROJECT, RUN)!;
    expect(after.revision).toBe(before.revision);
    expect(after.jobs.filter((job) => job.status !== before.jobs.find((prior) => prior.jobId === job.jobId)?.status)).toEqual([]);
  });

  it("structure: the multi-shot scheduler and the single-shot start both go through admitShotsForDispatch", () => {
    for (const file of ["electron/productionRun/multiShotBatchScheduler.ts", "electron/productionRun/singleShotProductionStart.ts"]) {
      expect(fs.existsSync(path.join(repoRoot, file)), file).toBe(true);
      const source = read(file);
      expect(source, file).toMatch(/from ["']\.\/shotLandingAdmission["']/);
      expect(source, file).toMatch(/admitShotsForDispatch\(/);
    }
  });

  it("structure: only the admission's callers reach the submission exit; nobody else calls submission.start", () => {
    const callers = productionSources().filter((file) => /\bsubmission\.start\(/.test(read(file).replace(/^\s*(\/\/|\*).*$/gm, "")));
    expect(callers.sort()).toEqual([
      "electron/capabilityCore/appIntegrationCanvasShot.ts",
      "electron/productionRun/multiShotBatchScheduler.ts",
      "electron/productionRun/singleShotProductionStart.ts",
    ]);
  });

  it("structure: the best-effort pre-landing is gone from every production start path", () => {
    for (const file of ["electron/capabilityCore/appIntegration.ts", "electron/capabilityCore/mcpStdioServer.ts"]) {
      expect(read(file), file).not.toMatch(/landCanvasBestEffort/);
    }
    expect(read("electron/productionRun/canvasLandingHost.ts")).not.toMatch(/landCanvasBestEffort/);
  });
});
