import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 一单出几张（张数 n / batch_size / output_count）：提交出口按序号给每一份各落一条账，一次下单、一次扣费。
// 设计卡 docs/plan/2026-11-09-multi-result-landing.md ★9 第 3、5、6 条。
// 以前这里只收「恰好一份」：上游交回两张，整单停成「需要处理」，钱花了、一张也落不进来。

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProviderOutput } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import { landedAdmission } from "./landFirstTestUtils";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text"], outputKinds: ["image"], modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } }, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "fixture-provider", models: [{ modelId: "fixture-model", modes: ["text-to-image"], parameterSchema: {},
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
}]);

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-multi-output-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => projectId === "project-1" ? root : null,
    now: () => "2026-11-09T00:00:00.000Z",
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const candidate: PlanCandidate = { candidateId: "candidate-1", revision: 1, moduleId: "generation.single-shot", providerId: "fixture-provider",
    modelId: "fixture-model", mode: "text-to-image", prompt: "A paper boat", parameters: { aspectRatio: "16:9" }, references: [] };
  const contract = compileExecutionContract(candidate, registry);
  repository.createGenerationDraft({ operationId: "op-1", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["fixture-provider"], allowedModels: ["fixture-model"], maxSpend: 0, maxAttemptsPerJob: 2 } });
  sealAndApproveProductionGeneration({ repository, projectId: "project-1", operationId: "op-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    projectRevision: 0, candidate, contract, now: "2026-11-09T00:00:00.000Z",
    providers: [{ providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true }, buildRequest: (input) => input, submit: async () => ({ providerTaskId: "unused" }) }] });
  return { root, repository };
}

const outputsOf = (count: number): GenerationProviderOutput[] => Array.from({ length: count }, (_, index) => ({ kind: "image", url: `https://cdn.example/out-${index + 1}.png` }));

function runnerFor(root: string, repository: ReturnType<typeof setup>["repository"], count: number, failOnce?: number) {
  const submit = vi.fn(async () => ({ providerTaskId: "provider-task-multi" }));
  const query = vi.fn(async () => ({ status: "completed", raw: { opaque: true } }));
  const materialize = vi.fn(async () => ({ outputs: outputsOf(count) }));
  let failed = false;
  /** 落盘：每份一个文件（真写进项目目录，数得出几个文件）。`failOnce` 那一份第一次落盘时进程「崩了」。 */
  const materializeOutput = vi.fn(async (input: { output: GenerationProviderOutput; outputIndex: number }) => {
    if (input.outputIndex === failOnce && !failed) { failed = true; throw new Error("process crashed mid-landing"); }
    const relative = `assets/generated/out-${input.outputIndex + 1}.png`;
    fs.mkdirSync(path.join(root, "assets", "generated"), { recursive: true });
    fs.writeFileSync(path.join(root, relative), input.output.url);
    return { artifactId: `asset-${input.outputIndex + 1}`, kind: "image" as const, contentHash: String(input.outputIndex + 1).repeat(64), projectRelativePath: relative };
  });
  const runner = createProductionGenerationSubmission({
    repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key",
    provider: { providerId: "fixture-provider", capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true },
      buildRequest: (input) => input, submit, query, materialize },
    materializeOutput,
    now: () => "2026-11-09T00:04:00.000Z",
  });
  return { runner, submit, query, materialize, materializeOutput };
}

const generatedFiles = (root: string) => fs.existsSync(path.join(root, "assets", "generated")) ? fs.readdirSync(path.join(root, "assets", "generated")).sort() : [];

describe("一单出 N 张：每一份各落一条账", () => {
  it.each([1, 2, 4])("N=%i：一次下单，账上 N 份产物（按序号派生的号），盘上 N 个文件，重进不再落", async (count) => {
    const { root, repository } = setup();
    const { runner, submit, materializeOutput } = runnerFor(root, repository, count);
    const input = { projectId: "project-1", operationId: "op-1" };
    await runner.start({ ...input, admission: await landedAdmission(repository, "project-1", "op-1") });
    await runner.poll(input);
    await expect(runner.materialize(input)).resolves.toMatchObject({ artifactId: "asset-1", nextAction: "completed" });
    await expect(runner.materialize(input)).resolves.toMatchObject({ artifactId: "asset-1", nextAction: "completed" });

    const run = repository.read("project-1", "op-1")!;
    const jobId = run.jobs[0]!.jobId;
    expect(run.jobs).toEqual([expect.objectContaining({ status: "ready" })]);
    expect(run.artifacts.filter((artifact) => artifact.jobId === jobId).map((artifact) => artifact.artifactId)).toEqual(Array.from({ length: count }, (_, index) => `asset-${index + 1}`));
    expect(generatedFiles(root)).toHaveLength(count);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(materializeOutput.mock.calls.map(([call]) => call.outputIndex)).toEqual(Array.from({ length: count }, (_, index) => index));
  });

  it("崩在两份之间：重进按序号补齐没落的那几份，已落的不再取、不再落盘", async () => {
    const { root, repository } = setup();
    const { runner, submit, materializeOutput } = runnerFor(root, repository, 3, 1);
    const input = { projectId: "project-1", operationId: "op-1" };
    await runner.start({ ...input, admission: await landedAdmission(repository, "project-1", "op-1") });
    await runner.poll(input);
    await expect(runner.materialize(input)).rejects.toThrow("process crashed mid-landing");
    const half = repository.read("project-1", "op-1")!;
    expect(half.artifacts.map((artifact) => artifact.artifactId)).toEqual(["asset-1"]);
    expect(half.jobs[0]!.status).not.toBe("ready");

    await expect(runner.materialize(input)).resolves.toMatchObject({ artifactId: "asset-1", nextAction: "completed" });
    const run = repository.read("project-1", "op-1")!;
    expect(run.artifacts.map((artifact) => artifact.artifactId)).toEqual(["asset-1", "asset-2", "asset-3"]);
    expect(run.jobs[0]!.status).toBe("ready");
    // 第 1 份只落过一次；第 2 份第一次崩了、重进补上；第 3 份重进时落。
    expect(materializeOutput.mock.calls.map(([call]) => call.outputIndex)).toEqual([0, 1, 1, 2]);
    expect(generatedFiles(root)).toEqual(["out-1.png", "out-2.png", "out-3.png"]);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("两次取产物清单之间上游换了签名链接：身份按序号认，不按地址——已落的不重落，缺的按新链接补，一共还是四份", async () => {
    const { root, repository } = setup();
    const { runner, submit, materializeOutput, materialize } = runnerFor(root, repository, 4, 1);
    let round = 0;
    materialize.mockImplementation(async () => {
      round += 1;
      return { outputs: Array.from({ length: 4 }, (_, index) => ({ kind: "image" as const, url: `https://cdn.example/out-${index + 1}.png?sig=round-${round}` })) };
    });
    const input = { projectId: "project-1", operationId: "op-1" };
    await runner.start({ ...input, admission: await landedAdmission(repository, "project-1", "op-1") });
    await runner.poll(input);
    await expect(runner.materialize(input)).rejects.toThrow("process crashed mid-landing");
    await expect(runner.materialize(input)).resolves.toMatchObject({ artifactId: "asset-1", nextAction: "completed" });

    const run = repository.read("project-1", "op-1")!;
    expect(run.artifacts.map((artifact) => artifact.artifactId)).toEqual(["asset-1", "asset-2", "asset-3", "asset-4"]);
    expect(materializeOutput.mock.calls.map(([call]) => [call.outputIndex, call.output.url])).toEqual([
      [0, "https://cdn.example/out-1.png?sig=round-1"],
      [1, "https://cdn.example/out-2.png?sig=round-1"],
      [1, "https://cdn.example/out-2.png?sig=round-2"],
      [2, "https://cdn.example/out-3.png?sig=round-2"],
      [3, "https://cdn.example/out-4.png?sig=round-2"],
    ]);
    expect(generatedFiles(root)).toHaveLength(4);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
