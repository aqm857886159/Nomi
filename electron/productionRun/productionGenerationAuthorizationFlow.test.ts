import { deriveGenerationReauthorizationState } from "./productionGenerationAuthorizationState";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApprovalReceiptAuthority } from "../capabilityCore/approvalReceipt";
import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { ProjectLeaseV2 } from "../capabilityCore/projectLease";
import { createRunOwnedGenerationGateAuthority, decideRunOwnedGenerationGate } from "../capabilityCore/runOwnedGenerationGateAuthority";
import { prepareProductionGenerationAuthorization, prepareProductionGenerationReauthorization } from "./prepareProductionGenerationAuthorization";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { productionRunPaths } from "./productionRunPaths";
import { createProductionRunRepository } from "./productionRunRepository";
import { landedAdmission } from "./landFirstTestUtils";
import { ModeInputMissingError } from "../catalog/taskParams";

const NOW = "2026-08-23T00:00:00.000Z";
const roots: string[] = [];
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } },
  assetInputSchema: {},
  providers: [{
    providerId: "fixture-provider",
    models: [{
      modelId: "fixture-model",
      modes: ["text-to-image"],
      parameterSchema: {},
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }],
  }],
}]);

const lease = {
  projectId: "project-1",
  immutableProjectUuid: "project-uuid-1",
  projectGeneration: 1,
  revocationEpoch: 0,
} as ProjectLeaseV2;

function candidate(): PlanCandidate {
  return {
    candidateId: "candidate-1",
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    mode: "text-to-image",
    prompt: "A paper boat on a quiet lake",
    parameters: { aspectRatio: "16:9" },
    references: [],
  };
}

function setup(approve = true, hardCap = 10) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-generation-authorization-flow-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => projectId === "project-1" ? root : null,
    now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const planCandidate = candidate();
  const contract = compileExecutionContract(planCandidate, registry);
  let drifted = false;
  let throwAtBuild: Error | null = null;
  const submit = vi.fn(async () => ({ providerTaskId: `provider-task-${submit.mock.calls.length}` }));
  const provider: GenerationProvider = {
    providerId: "fixture-provider",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (request) => {
      if (throwAtBuild) throw throwAtBuild;
      return {
      model: request.modelId,
      prompt: drifted ? `${request.prompt} changed` : request.prompt,
      parameters: request.parameters,
      };
    },
    submit,
  };
  repository.createGenerationDraft({
    operationId: "op-1",
    projectId: "project-1",
    origin: { host: "semantic-mcp" },
    candidate: planCandidate,
    policy: {
      trustedHosts: ["semantic-mcp"],
      allowedProviders: ["fixture-provider"],
      allowedModels: ["fixture-model"],
      maxSpend: hardCap,
      maxAttemptsPerJob: 2,
    },
  });
  const authorization = prepareProductionGenerationAuthorization({
    lease,
    projectRevision: 12,
    operation: { operationId: "op-1", projectId: "project-1", candidate: planCandidate, planVersion: 1 },
    contract,
    // 授权站在真实 Run 上：attempt 谱系和硬上限都从它算（`run` 是必填，不再有 attempt 恒为 1 的降级口）。
    run: repository.read("project-1", "op-1")!,
    providers: [provider],
    resolveShotPrice: () => ({ known: true, amount: 6 }),
    now: NOW,
  });
  const sealed = repository.execute("project-1", "op-1", {
    commandId: "seal-authorized",
    expectedRevision: 0,
    type: "generation.seal",
    payload: { contract, authorization },
    issuedAt: NOW,
  }).run;
  if (approve) {
    repository.execute("project-1", "op-1", {
      commandId: "decide-authorized",
      expectedRevision: sealed.revision,
      type: "gate.decide",
      payload: {
        gateId: authorization.envelope.gateId,
        status: "approved",
        receiptId: "receipt-1",
        authorizationDigest: authorization.authorizationDigest,
      },
      issuedAt: NOW,
    });
  }
  const submission = createProductionGenerationSubmission({
    repository,
    beforeDispatch: () => undefined,
    projectRoot: root,
    immutableProjectUuid: lease.immutableProjectUuid,
    projectGeneration: lease.projectGeneration,
    intentMacKey: "test-intent-key",
    providers: [provider],
    now: () => NOW,
  });
  return { root, repository, contract, authorization, submission, submit, provider, setDrifted: (value: boolean) => { drifted = value; }, setThrowAtBuild: (error: Error | null) => { throwAtBuild = error; } };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Run-owned paid generation authorization", () => {
  it("uses a human receipt to approve the sealed gate through the shared authority", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: async (projectId: string, runId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, runId, command),
    };
    const decision = await decideRunOwnedGenerationGate({
      owner: owner as never,
      receipts,
      lease,
      operationId: "op-1",
      authorization,
      commandPrefix: "test-authority",
      display: { model: "fixture-model" },
      now: () => NOW,
      confirm: async ({ challengeToken }) => {
        const attestation = receipts.createMainProcessGestureAttestation(challengeToken, {
          webContentsId: 1,
          frameId: 2,
          origin: "app://nomi",
          decision: "accept",
        });
        const receipt = receipts.mintReceipt(challengeToken, attestation);
        return { confirmed: true, receiptToken: receipt.token };
      },
    });

    expect(decision.approved).toBe(true);
    expect(decision.run.gates).toEqual([expect.objectContaining({ status: "approved" })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([expect.objectContaining({
      authorizationDigest: authorization.authorizationDigest,
    })]);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(6);
  });

  // 付费卡① 第 14 条（2026-10-01）：批的是信封里冻住的事实，不是项目此刻的版本。确认框开着的时候 Nomi 往画布上
  // 落别的镜、用户改下一镜，项目版本都会前进——以前这里把这一下点击拒成「项目有变动」，而卡上的东西一个字没变。
  // 发出去的东西由合同哈希、线上报文哈希、幂等键逐字钉死，和项目版本无关。
  it("approves when the project moved on after the confirmation was shown: the approval binds to the sealed envelope", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: async (projectId: string, runId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, runId, command),
    };

    const decision = await decideRunOwnedGenerationGate({
      owner: owner as never,
      receipts,
      lease,
      operationId: "op-1",
      authorization,
      commandPrefix: "test-revision-drift",
      display: { model: "fixture-model" },
      now: () => NOW,
      // 卡开着的这段时间里项目往前走了（别的镜落了画布）——这一下确认照样算数。
      confirm: async ({ challengeToken }) => {
        const attestation = receipts.createMainProcessGestureAttestation(challengeToken, {
          webContentsId: 1,
          frameId: 2,
          origin: "app://nomi",
          decision: "accept",
        });
        const receipt = receipts.mintReceipt(challengeToken, attestation);
        return { confirmed: true, receiptToken: receipt.token };
      },
    });

    expect(decision.approved).toBe(true);
    expect(repository.read("project-1", "op-1")?.gates).toEqual([expect.objectContaining({ status: "approved" })]);
    // 批下来的就是那份信封：同一个摘要、同一个封好时的版本。
    expect(repository.readApprovals("project-1", "op-1")).toEqual([expect.objectContaining({ authorizationDigest: authorization.authorizationDigest })]);
    expect(authorization.envelope.projectRevision).toBe(12);
  });

  it("issues the challenge even when the project moved on after sealing (the gate binds to its envelope, rule 14)", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: async (projectId: string, runId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, runId, command),
    };
    const planning = vi.fn(async () => ({ operationId: "op-1", model: "fixture-model", contractHash: authorization.authorizationDigest }));
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: owner as never,
      operations: { read: vi.fn(async () => undefined) } as never,
      planning: planning as never,
      receipts,
      now: () => NOW,
    });

    const gate = await generationAuthority.requestGenerationGate({ params: { operationId: "op-1" }, lease }) as { handoff?: { challengeToken?: string }; gateId?: string };
    expect(gate.gateId).toBe(authorization.envelope.gateId);
    expect(gate.handoff?.challengeToken).toEqual(expect.any(String));
    expect(authorization.envelope.projectRevision).toBe(12);
  });

  it("rejects a malformed sealed gate before issuing a request-time challenge", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const malformed = repository.read("project-1", "op-1")!;
    malformed.generationPlan = undefined;
    const owner = {
      readFull: () => malformed,
      command: vi.fn(),
    };
    const planning = vi.fn(async () => ({ operationId: "op-1", model: "fixture-model", contractHash: authorization.authorizationDigest }));
    const requestChallenge = vi.spyOn(receipts, "requestChallenge");
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: owner as never,
      operations: { read: vi.fn(async () => undefined) } as never,
      planning: planning as never,
      receipts,
      now: () => NOW,
    });

    await expect(generationAuthority.requestGenerationGate({ params: { operationId: "op-1" }, lease }))
      .rejects.toThrow("Generation gate does not match the sealed Run authorization");
    expect(planning).toHaveBeenCalledTimes(1);
    expect(requestChallenge).not.toHaveBeenCalled();
  });

  it("rejects an expired sealed authorization at request time without issuing a challenge", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: vi.fn(),
    };
    const planning = vi.fn(async () => ({ operationId: "op-1", model: "fixture-model", contractHash: authorization.authorizationDigest }));
    const requestChallenge = vi.spyOn(receipts, "requestChallenge");
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: owner as never,
      operations: { read: vi.fn(async () => undefined) } as never,
      planning: planning as never,
      receipts,
      now: () => "2026-08-24T00:00:00.000Z",
    });

    await expect(generationAuthority.requestGenerationGate({ params: { operationId: "op-1" }, lease }))
      .rejects.toThrow("Generation authorization has expired");
    expect(planning).toHaveBeenCalledTimes(1);
    expect(requestChallenge).not.toHaveBeenCalled();
  });

  it("does not authorize a valid receipt against a gate that is no longer waiting", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const challenge = receipts.requestChallenge({
      challengeKey: "non-waiting-gate",
      immutableProjectUuid: authorization.envelope.immutableProjectUuid,
      projectGeneration: authorization.envelope.projectGeneration,
      projectId: authorization.envelope.projectId,
      runId: authorization.envelope.runId,
      gateId: authorization.envelope.gateId,
      contractHash: authorization.authorizationDigest,
      targetHash: authorization.authorizationDigest,
      projectRevision: authorization.envelope.projectRevision,
      revocationEpoch: lease.revocationEpoch,
      costScope: authorization.envelope.costScope,
      pricingSnapshotHash: authorization.authorizationDigest,
      reservationPreview: { ...authorization.envelope.budget },
    });
    const gesture = receipts.createMainProcessGestureAttestation(challenge.token, {
      webContentsId: 1,
      frameId: 2,
      origin: "app://nomi",
      decision: "accept",
    });
    const receipt = receipts.mintReceipt(challenge.token, gesture).receipt;
    const current = repository.read("project-1", "op-1")!;
    const approved = {
      ...current,
      gates: current.gates.map((gate) => ({ ...gate, status: "approved" as const })),
    };
    const owner = {
      readFull: () => approved,
      command: vi.fn(),
    };
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: owner as never,
      operations: { read: vi.fn(async () => undefined) } as never,
      planning: vi.fn() as never,
      receipts,
      now: () => NOW,
    });

    await expect(generationAuthority.authorizeGeneration({ params: { operationId: "op-1" }, lease, receipt }))
      .rejects.toThrow("Generation authorization gate is not waiting for this receipt");
    await expect(generationAuthority.authorizeGeneration({
      params: { operationId: "op-1" },
      lease,
      receipt: { ...receipt, projectRevision: 13 },
    })).rejects.toThrow("Generation approval receipt does not match the sealed Run authorization");
    expect(owner.command).not.toHaveBeenCalled();
  });

  it("authorizes a valid receipt through the production gate and forwards the sealed revision", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const challenge = receipts.requestChallenge({
      challengeKey: "authorize-production-gate",
      immutableProjectUuid: authorization.envelope.immutableProjectUuid,
      projectGeneration: authorization.envelope.projectGeneration,
      projectId: authorization.envelope.projectId,
      runId: authorization.envelope.runId,
      gateId: authorization.envelope.gateId,
      contractHash: authorization.authorizationDigest,
      targetHash: authorization.authorizationDigest,
      projectRevision: authorization.envelope.projectRevision,
      revocationEpoch: lease.revocationEpoch,
      costScope: authorization.envelope.costScope,
      pricingSnapshotHash: authorization.authorizationDigest,
      reservationPreview: { ...authorization.envelope.budget },
    });
    const gesture = receipts.createMainProcessGestureAttestation(challenge.token, {
      webContentsId: 1,
      frameId: 2,
      origin: "app://nomi",
      decision: "accept",
    });
    const receipt = receipts.mintReceipt(challenge.token, gesture).receipt;
    const current = repository.read("project-1", "op-1")!;
    const command = vi.fn(async (_projectId: string, _operationId: string, value: Parameters<typeof repository.execute>[2]) => ({
      run: current,
      events: [value as never],
    }));
    const operationsRead = vi.fn(async () => ({ operationId: "op-1", state: "sealed" }));
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: {
        readFull: () => current,
        command,
      } as never,
      operations: { read: operationsRead } as never,
      planning: vi.fn() as never,
      receipts,
      now: () => NOW,
    });

    await expect(generationAuthority.authorizeGeneration({ params: { operationId: "op-1" }, lease, receipt }))
      .resolves.toMatchObject({ operationId: "op-1", nextAction: "start", state: "sealed" });
    expect(command).toHaveBeenCalledWith("project-1", "op-1", expect.objectContaining({
      type: "gate.decide",
      payload: expect.objectContaining({ projectRevision: 12, receiptId: receipt.receiptId }),
    }));
    expect(operationsRead).toHaveBeenCalledTimes(1);
  });

  it("rejects the shared gate without creating Approval or budget authority", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: async (projectId: string, runId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, runId, command),
    };
    const decision = await decideRunOwnedGenerationGate({
      owner: owner as never,
      receipts,
      lease,
      operationId: "op-1",
      authorization,
      commandPrefix: "test-authority",
      display: { model: "fixture-model" },
      now: () => NOW,
      confirm: async () => ({ confirmed: false }),
    });

    expect(decision.approved).toBe(false);
    expect(decision.run.gates).toEqual([expect.objectContaining({ status: "rejected" })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([]);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(0);
  });

  it("persists one digest-bound gate, Approval and budget authorization", () => {
    const { repository, authorization } = setup();
    const run = repository.read("project-1", "op-1")!;
    // 授权住在它自己那道门上；计划上不再挂一份（2026-09-30，每点一次一份）。
    for (const field of ["authorizationEnvelope", "authorizationDigest", "authorizationGateId", "approvedReceiptId", "planHash"]) {
      expect(run.generationPlan, `计划上不许再有 ${field}`).not.toHaveProperty(field);
    }
    expect(run.gates[0]?.authorizationEnvelope, "信封住在门上").toEqual(authorization.envelope);
    expect(run.jobs).toEqual([expect.objectContaining({
      jobId: authorization.envelope.jobs[0].jobId,
      status: "authorized",
      authorizationDigest: authorization.authorizationDigest,
    })]);
    expect(run.gates).toEqual([expect.objectContaining({
      gateId: authorization.envelope.gateId,
      status: "approved",
      receiptId: "receipt-1",
      authorizationDigest: authorization.authorizationDigest,
    })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([expect.objectContaining({
      approvalId: `approval:${authorization.envelope.gateId}`,
      authorizationDigest: authorization.authorizationDigest,
      receiptId: "receipt-1",
      maxSpend: 6,
    })]);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(6);
  });

  it("rejects provider payload drift before any durable or provider side effect", async () => {
    const { root, repository, authorization, submission, submit, setDrifted } = setup();
    // 先落节点（派发前的那一步，属于开拍、不属于提交出口）。之后提交出口派发前唯一的写入是「确定拒收 → needs_attention」
    // （见下一组）；指纹漂移今天还不是确定拒收，所以这里什么都不写。
    const admission = await landedAdmission(repository, "project-1", "op-1");
    const beforeRun = structuredClone(repository.read("project-1", "op-1"));
    const beforeApprovals = structuredClone(repository.readApprovals("project-1", "op-1"));
    const beforeLedger = structuredClone(repository.readBudgetLedger("project-1", "op-1"));
    setDrifted(true);

    await expect(submission.start({ projectId: "project-1", operationId: "op-1", admission }))
      .rejects.toThrow("Provider wire payload no longer matches the approved authorization");

    expect(repository.read("project-1", "op-1")).toEqual(beforeRun);
    expect(repository.readApprovals("project-1", "op-1")).toEqual(beforeApprovals);
    expect(repository.readBudgetLedger("project-1", "op-1")).toEqual(beforeLedger);
    const paths = productionRunPaths(root, "op-1");
    expect(fs.existsSync(paths.intents)).toBe(false);
    expect(fs.existsSync(path.join(root, ".nomi", "runs", "op-1", "jobs", authorization.envelope.jobs[0].jobId, "runtime-envelope.json"))).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  describe("definite pre-send refusal (mode input missing) at dispatch", () => {
    // 升级前批准、派发时新代码才发现方式要的输入请求里没有：真实目录路径上的两种（可灵编辑缺源视频、H3 首尾帧只给 1 张图）
    // 由 electron/parity/approvedBeforeUpgrade.test.ts 钉原话；这里钉提交门怎么落：job → needs_attention + 原话，零请求、零出站。
    const REFUSALS = [
      ["Kling edit without a source video", "这次没有发出：这个方式需要源视频，请求里没有。请补上源视频，或换一个方式。现有输入可以用「全能参考」方式（ref）发。"],
      ["MiniMax-H3 first+last with one image", "这次没有发出：这个方式需要尾帧，请求里没有。请补上尾帧，或换一个方式。现有输入可以用「首帧」方式（first）发。"],
    ] as const;

    it.each(REFUSALS)("%s: the job lands on needs_attention with the refusal text; nothing is reserved, written to the outbox or sent", async (_name, text) => {
      const { root, repository, authorization, submission, submit, setThrowAtBuild } = setup();
      const admission = await landedAdmission(repository, "project-1", "op-1");
      const beforeApprovals = structuredClone(repository.readApprovals("project-1", "op-1"));
      const beforeLedger = structuredClone(repository.readBudgetLedger("project-1", "op-1"));
      // 供应商适配层会再包一层（CatalogGenerationProviderError 带 cause）：提交门顺着 cause 认。
      setThrowAtBuild(new Error("provider wrapper", { cause: new ModeInputMissingError(text) }));

      await expect(submission.start({ projectId: "project-1", operationId: "op-1", admission })).rejects.toThrow("provider wrapper");

      const run = repository.read("project-1", "op-1")!;
      expect(run.jobs).toEqual([expect.objectContaining({
        jobId: authorization.envelope.jobs[0].jobId,
        status: "needs_attention",
        errorCode: "mode_input_missing",
        errorMessage: text,
      })]);
      expect(repository.readApprovals("project-1", "op-1")).toEqual(beforeApprovals);
      expect(repository.readBudgetLedger("project-1", "op-1")).toEqual(beforeLedger);
      expect(run.budget.reserved).toBe(0);
      const paths = productionRunPaths(root, "op-1");
      expect(fs.existsSync(paths.intents)).toBe(false);
      expect(fs.existsSync(path.join(root, ".nomi", "runs", "op-1", "jobs", authorization.envelope.jobs[0].jobId, "runtime-envelope.json"))).toBe(false);
      expect(submit).not.toHaveBeenCalled();

      // 再开一次门也不会发：这一镜已经不是 authorized（防重复派发）。
      await expect(submission.start({ projectId: "project-1", operationId: "op-1", admission })).rejects.toThrow();
      expect(submit).not.toHaveBeenCalled();
    });

    it("an ordinary error from prepareAuthorization writes nothing (the write door is not widened)", async () => {
      const { root, repository, submission, submit, setThrowAtBuild } = setup();
      const admission = await landedAdmission(repository, "project-1", "op-1");
      const beforeRun = structuredClone(repository.read("project-1", "op-1"));
      const beforeLedger = structuredClone(repository.readBudgetLedger("project-1", "op-1"));
      const plain = Object.assign(new Error("socket hang up"), { code: "mode_input_missing" });
      setThrowAtBuild(plain);

      await expect(submission.start({ projectId: "project-1", operationId: "op-1", admission })).rejects.toThrow("socket hang up");

      expect(repository.read("project-1", "op-1")).toEqual(beforeRun);
      expect(repository.readBudgetLedger("project-1", "op-1")).toEqual(beforeLedger);
      expect(fs.existsSync(productionRunPaths(root, "op-1").intents)).toBe(false);
      expect(submit).not.toHaveBeenCalled();
    });

    it("the creator has a way out: after the input is added, the needs_attention shot is re-approved and sent as attempt 2", async () => {
      const { repository, submission, submit, provider, setThrowAtBuild } = setup(true, 12);
      setThrowAtBuild(new ModeInputMissingError(REFUSALS[0][1]));
      await expect(submission.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).rejects.toThrow();
      let run = repository.read("project-1", "op-1")!;
      const refusedJob = run.jobs[0];
      expect(refusedJob.status).toBe("needs_attention");
      // 批过还没派的那份钱随 authorized 离开而不再算进已担（committedLiability 只数 authorized），第二份批得下。
      setThrowAtBuild(null);
      const reauthorization = prepareProductionGenerationReauthorization({
        lease, projectRevision: 12, run, providers: [provider],
        resolveShotPrice: () => ({ known: true, amount: 6 }), now: "2026-08-23T00:01:00.000Z",
      });
      run = repository.execute("project-1", "op-1", {
        commandId: "rework-after-refusal", expectedRevision: run.revision, type: "generation.reauthorize",
        payload: { authorization: reauthorization }, issuedAt: "2026-08-23T00:01:00.000Z",
      }).run;
      run = repository.execute("project-1", "op-1", {
        commandId: "approve-after-refusal", expectedRevision: run.revision, type: "gate.decide",
        payload: { gateId: reauthorization.envelope.gateId, status: "approved", receiptId: "receipt-after-refusal", authorizationDigest: reauthorization.authorizationDigest },
        issuedAt: "2026-08-23T00:01:00.000Z",
      }).run;
      expect(run.jobs.find((job) => job.attempt === 2)).toMatchObject({ status: "authorized", parentJobId: refusedJob.jobId });

      await submission.start({ projectId: "project-1", operationId: "op-1", attempt: 2, admission: await landedAdmission(repository, "project-1", "op-1") });
      expect(submit).toHaveBeenCalledTimes(1);
      const final = repository.read("project-1", "op-1")!;
      expect(final.jobs.find((job) => job.attempt === 1)?.status).toBe("needs_attention");
      expect(final.jobs.find((job) => job.attempt === 2)).toMatchObject({ status: "provider_accepted" });
    });
  });

  it("submits the already-verified prepared request without creating another Approval or authorization", async () => {
    const { repository, submission, submit } = setup();
    const approvalsBefore = repository.readApprovals("project-1", "op-1");
    await expect(submission.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") }))
      .resolves.toMatchObject({ providerTaskId: "provider-task-1", nextAction: "observe" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(repository.readApprovals("project-1", "op-1")).toEqual(approvalsBefore);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(6);
  });

  it("rejecting the spend gate creates no Approval, budget authority, or provider side effect", () => {
    const { repository, authorization, submit } = setup(false);
    const before = repository.read("project-1", "op-1")!;
    const rejected = repository.execute("project-1", "op-1", {
      commandId: "decline-authorization",
      expectedRevision: before.revision,
      type: "gate.decide",
      payload: {
        gateId: authorization.envelope.gateId,
        status: "rejected",
        authorizationDigest: authorization.authorizationDigest,
      },
      issuedAt: NOW,
    }).run;

    expect(rejected.gates).toEqual([expect.objectContaining({ status: "rejected" })]);
    expect(rejected.gates[0].receiptId).toBeUndefined();
    expect(rejected.jobs).toEqual([expect.objectContaining({ status: "authorization_required" })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([]);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(0);
    expect(submit).not.toHaveBeenCalled();
  });

  it("rework uses a fresh digest, gate, Approval and budget before dispatching only attempt 2", async () => {
    const { repository, authorization: initial, submission, submit, provider } = setup(true, 12);
    await submission.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") });
    let run = repository.read("project-1", "op-1")!;
    const firstJob = run.jobs[0];
    run = repository.execute("project-1", "op-1", {
      commandId: "test:first-attempt-ready",
      expectedRevision: run.revision,
      type: "job.status",
      payload: { jobId: firstJob.jobId, status: "ready" },
      issuedAt: NOW,
    }).run;
    const reauthorization = prepareProductionGenerationReauthorization({
      lease,
      projectRevision: 12,
      run,
      providers: [provider],
      resolveShotPrice: () => ({ known: true, amount: 6 }),
      now: "2026-08-23T00:01:00.000Z",
    });
    expect(reauthorization.authorizationDigest).not.toBe(initial.authorizationDigest);
    expect(() => deriveGenerationReauthorizationState({
      run: { ...run, policy: { ...run.policy, maxSpend: 10 } }, preparation: reauthorization, now: NOW,
    })).toThrow(/safely extend/);

    run = repository.execute("project-1", "op-1", {
      commandId: "request-rework",
      expectedRevision: run.revision,
      type: "generation.reauthorize",
      payload: { authorization: reauthorization },
      issuedAt: "2026-08-23T00:01:00.000Z",
    }).run;
    const reworkedJob = run.jobs.find((job) => job.jobId === reauthorization.envelope.jobs[0].jobId);
    expect(reworkedJob).toBeDefined();
    expect(reworkedJob).toMatchObject({
      jobId: reauthorization.envelope.jobs[0].jobId,
      status: "authorization_required",
      attempt: 2,
      parentJobId: firstJob.jobId,
      retryCount: 1,
      metadata: expect.objectContaining({ retryCount: 1, retryReason: "rework", parentJobId: firstJob.jobId }),
      authorizationDigest: reauthorization.authorizationDigest,
    });
    expect(submit).toHaveBeenCalledTimes(1);

    run = repository.execute("project-1", "op-1", {
      commandId: "approve-rework",
      expectedRevision: run.revision,
      type: "gate.decide",
      payload: {
        gateId: reauthorization.envelope.gateId,
        status: "approved",
        receiptId: "receipt-rework",
        authorizationDigest: reauthorization.authorizationDigest,
      },
      issuedAt: "2026-08-23T00:01:00.000Z",
    }).run;
    expect(run.budget.authorized).toBe(12);
    expect(repository.readApprovals("project-1", "op-1")).toContainEqual(expect.objectContaining({
      approvalId: `approval:${reauthorization.envelope.gateId}`,
      authorizationDigest: reauthorization.authorizationDigest,
      receiptId: "receipt-rework",
      jobIds: [reauthorization.envelope.jobs[0].jobId],
      maxSpend: 6,
    }));

    await submission.start({ projectId: "project-1", operationId: "op-1", attempt: 2, admission: await landedAdmission(repository, "project-1", "op-1") });
    expect(submit).toHaveBeenCalledTimes(2);
    const final = repository.read("project-1", "op-1")!;
    expect(final.jobs.find((job) => job.attempt === 1)?.status).toBe("ready");
    expect(final.jobs.find((job) => job.attempt === 2)).toMatchObject({ status: "provider_accepted" });
  });
});
