/**
 * 一次落地要写好几份记录（产物、job、信封），崩在任何两步之间都会留下半状态：下一次查必须能收尾，不多花钱，也不把这个节点一直锁着。
 * 等锁也一样：锁文件坏了、持有者死了，等待方要么回收，要么到期把「忙」交给上层，不能无限等。
 * 方向检查：docs/engineering/direction-checks/2026-10-31-run-recovery-materialize.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import { landedAdmission } from "./landFirstTestUtils";
import { markSingleShotAttention, reopenSingleShotRetrieval } from "./singleShotRunLifecycle";

const roots: string[] = [];
const PROVIDER_CAPABILITIES = { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true };
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text"], outputKinds: ["image"], modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } }, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "fixture-provider", models: [{ modelId: "fixture-model", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
}]);
const candidate = (): PlanCandidate => ({ candidateId: "candidate-1", revision: 1, moduleId: "generation.single-shot", providerId: "fixture-provider", modelId: "fixture-model", mode: "text-to-image", prompt: "A paper boat", parameters: { aspectRatio: "16:9" }, references: [] });
const input = { projectId: "project-1", operationId: "op-1" };
const now = () => "2026-08-23T00:03:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function repositoryAt(root: string) {
  return createProductionRunRepository({ projectDirResolver: (id) => (id === "project-1" ? root : null), now });
}

async function acceptedTask(status = "completed") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-crash-recovery-"));
  roots.push(root);
  const repository = repositoryAt(root);
  const planCandidate = candidate();
  const contract = compileExecutionContract(planCandidate, registry);
  repository.createGenerationDraft({ operationId: "op-1", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate: planCandidate,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["fixture-provider"], allowedModels: ["fixture-model"], maxSpend: 0, maxAttemptsPerJob: 2 } });
  sealAndApproveProductionGeneration({ repository, projectId: "project-1", operationId: "op-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0, candidate: planCandidate, contract,
    providers: [{ providerId: "fixture-provider", capabilities: PROVIDER_CAPABILITIES, buildRequest: (value: unknown) => value, submit: async () => ({ providerTaskId: "unused" }) }], now: "2026-08-23T00:00:00.000Z" } as never);
  const shared = {
    status,
    submit: vi.fn(async () => ({ providerTaskId: "task-1" })),
    queries: vi.fn(),
    materializeOutput: vi.fn(async () => ({ artifactId: "art-1", kind: "image" as const, contentHash: "c".repeat(64), projectRelativePath: "assets/a.png" })),
  };
  const submissionOn = (repo: ReturnType<typeof createProductionRunRepository>) => createProductionGenerationSubmission({
    repository: repo, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "non-secret-fixture", beforeDispatch: () => undefined, now,
    materializeOutput: shared.materializeOutput as never,
    provider: { providerId: "fixture-provider", capabilities: PROVIDER_CAPABILITIES, buildRequest: (value: unknown) => value, submit: shared.submit as never,
      query: async () => { shared.queries(); return { status: shared.status, raw: { source: "query" } }; },
      materialize: async () => ({ outputs: [{ kind: "image", url: "https://cdn.example.test/a.png" }] }) } as never,
  });
  const started = await submissionOn(repository).start({ ...input, admission: await landedAdmission(repository, input.projectId, input.operationId) });
  const envelopeFile = path.join(root, ".nomi/runs/op-1/jobs", started.jobId, "runtime-envelope.json");
  return { root, repository, shared, submissionOn, envelopeFile, jobId: started.jobId, read: () => repository.read("project-1", "op-1")! };
}

/** 崩在写这条命令的时候：这一次之前的都已落盘，这条和后面的都没写。 */
function crashingOn(root: string, fragment: string) {
  const repository = repositoryAt(root);
  const execute = repository.execute.bind(repository);
  let armed = true;
  (repository as { execute: typeof execute }).execute = ((projectId, runId, command) => {
    if (armed && command.commandId.includes(fragment)) { armed = false; throw new Error("simulated crash while landing"); }
    return execute(projectId, runId, command);
  }) as typeof execute;
  return repository;
}

describe("落地崩在任何两步之间，下一次查都能收尾", () => {
  it.each([
    { point: "产物文件写好、记账之前", fragment: "materialize-artifact:", landings: 2 },
    { point: "产物记账之后、job 收尾之前（T10）", fragment: "materialize-job:", landings: 1 },
  ])("$point", async ({ fragment, landings }) => {
    const test = await acceptedTask();
    await test.submissionOn(test.repository).poll(input);
    await expect(test.submissionOn(crashingOn(test.root, fragment)).materialize(input)).rejects.toThrow("simulated crash");

    await test.submissionOn(repositoryAt(test.root)).materialize(input);

    expect(test.read().jobs[0]).toMatchObject({ status: "ready" });
    expect(test.read().artifacts.filter((artifact) => artifact.status === "ready")).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(test.envelopeFile, "utf8")).state).toBe("materialized");
    expect(test.shared.materializeOutput).toHaveBeenCalledTimes(landings);
    expect(test.shared.submit).toHaveBeenCalledTimes(1);
  });

  it("job 收尾之后、信封标记之前：下一次查把信封补上，不再落一次", async () => {
    const test = await acceptedTask();
    const submission = test.submissionOn(test.repository);
    await submission.poll(input);
    const beforeComplete = fs.readFileSync(test.envelopeFile);
    await submission.materialize(input);
    fs.writeFileSync(test.envelopeFile, beforeComplete);

    const again = await submission.materialize(input);

    expect(again.artifactId).toBe("art-1");
    expect(JSON.parse(fs.readFileSync(test.envelopeFile, "utf8")).state).toBe("materialized");
    expect(test.shared.materializeOutput).toHaveBeenCalledTimes(1);
    expect(test.read().jobs[0]).toMatchObject({ status: "ready" });
  });

  it("全部写完之后崩：再查一次什么都不写，结果不变", async () => {
    const test = await acceptedTask();
    const submission = test.submissionOn(test.repository);
    await submission.poll(input);
    const first = await submission.materialize(input);
    const revision = test.read().revision;

    await expect(submission.materialize(input)).resolves.toEqual(first);

    expect(test.read().revision).toBe(revision);
  });

  it("修复之前已经落下的半状态（信封已标 materialized，job 还是进行中）：下一次查补上 job", async () => {
    const test = await acceptedTask();
    await test.submissionOn(test.repository).poll(input);
    await expect(test.submissionOn(crashingOn(test.root, "materialize-job:")).materialize(input)).rejects.toThrow();
    const envelope = JSON.parse(fs.readFileSync(test.envelopeFile, "utf8"));
    fs.writeFileSync(test.envelopeFile, JSON.stringify({ ...envelope, state: "materialized" }));

    const polled = await test.submissionOn(repositoryAt(test.root)).poll(input);
    expect(polled.nextAction).toBe("materialize");
    await test.submissionOn(repositoryAt(test.root)).materialize(input);

    expect(test.read().jobs[0]).toMatchObject({ status: "ready" });
    expect(test.shared.submit).toHaveBeenCalledTimes(1);
  });

  it("崩了之后这一笔被停成待取回：产物已在账上，job 经轮询回到 ready，错误清掉", async () => {
    const test = await acceptedTask();
    await test.submissionOn(test.repository).poll(input);
    await expect(test.submissionOn(crashingOn(test.root, "materialize-job:")).materialize(input)).rejects.toThrow();
    markSingleShotAttention(test.repository, "project-1", "op-1", test.jobId);
    expect(test.read().jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "output_retrieval_failed" });

    await test.submissionOn(repositoryAt(test.root)).materialize(input);

    const job = test.read().jobs[0]!;
    expect(job.status).toBe("ready");
    expect(job.errorCode ?? "").toBe("");
    expect(job.errorMessage ?? "").toBe("");
  });

  it("这一笔已经不在进行中（请求了取消）：产物照样记上，job 不硬改，不抛错", async () => {
    const test = await acceptedTask();
    await test.submissionOn(test.repository).poll(input);
    await expect(test.submissionOn(crashingOn(test.root, "materialize-job:")).materialize(input)).rejects.toThrow();
    const run = test.read();
    test.repository.execute("project-1", "op-1", { commandId: "cancel-1", expectedRevision: run.revision, type: "job.status", payload: { jobId: test.jobId, status: "cancel_requested" }, issuedAt: now() });

    await expect(test.submissionOn(repositoryAt(test.root)).materialize(input)).resolves.toMatchObject({ artifactId: "art-1" });

    expect(test.read().jobs[0]).toMatchObject({ status: "cancel_requested" });
  });

  it("供应商回过认不出的状态：放回轮询再查，这次认得了就落地，不再提交", async () => {
    const test = await acceptedTask("mystery_state");
    const submission = test.submissionOn(test.repository);
    expect((await submission.poll(input)).nextAction).toBe("attention");
    expect(test.read().jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "provider_status_unknown" });

    test.shared.status = "completed";
    expect(reopenSingleShotRetrieval(test.repository, "project-1", "op-1", test.jobId)).not.toBeNull();
    expect((await submission.poll(input)).nextAction).toBe("materialize");
    await submission.materialize(input);

    expect(test.read().jobs[0]).toMatchObject({ status: "ready" });
    expect(test.shared.submit).toHaveBeenCalledTimes(1);
  });
});

describe("等生命周期锁不能无限等（T1）", () => {
  async function withLock(content: string, ageMs: number) {
    const test = await acceptedTask("processing");
    const submission = test.submissionOn(test.repository);
    await submission.poll(input);
    const lockFile = `${test.envelopeFile}.lifecycle-lock`;
    fs.writeFileSync(lockFile, content);
    const stamped = new Date(Date.now() - ageMs);
    fs.utimesSync(lockFile, stamped, stamped);
    test.shared.status = "completed";
    return { test, submission, lockFile };
  }

  it("空的锁记录放了超过一个租期（崩在 open 和 write 之间）：查询立刻能完成", async () => {
    const { test, submission, lockFile } = await withLock("", 31_000);
    await expect(submission.poll(input)).resolves.toMatchObject({ nextAction: "materialize" });
    expect(fs.existsSync(lockFile)).toBe(false);
    expect(test.shared.submit).toHaveBeenCalledTimes(1);
  });

  it("写了一半的锁记录，还差一点到一个租期：等它到了就回收，查询能完成", async () => {
    const { submission } = await withLock('{"schemaVersion":1,"owner', 29_500);
    const startedAt = performance.now();
    await expect(submission.poll(input)).resolves.toMatchObject({ nextAction: "materialize" });
    expect(performance.now() - startedAt).toBeGreaterThan(300);
  });

  it("死掉的持有者留下有效租约：等到它过期（行为不变）", async () => {
    const expiresAt = new Date(Date.now() + 800).toISOString();
    const { submission } = await withLock(JSON.stringify({ schemaVersion: 1, ownerId: "dead", pid: 999999, acquiredAt: new Date().toISOString(), expiresAt, fencingEpoch: 1, nonce: "n" }), 0);
    const startedAt = performance.now();
    await expect(submission.poll(input)).resolves.toMatchObject({ nextAction: "materialize" });
    expect(performance.now() - startedAt).toBeGreaterThan(500);
  });
});
