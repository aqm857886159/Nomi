import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { dispatch } from "./dispatcher";
import { validateToolArguments } from "./mcpArgValidation";
import { buildToolErrorOutcome } from "./mcpToolErrorResults";
import { ONBOARDING_VERBS } from "./modelOnboarding/declarations";
import { MODEL_ONBOARDING_TOOLS, requiredFor } from "./modelOnboarding/tools";
import { createApprovalReceiptAuthority } from "./approvalReceipt";
import { createProjectLeaseAuthority } from "./projectLease";
import { IntegrationSessionService } from "../integrationCertification/integrationSession";
import { INTEGRATION_STAGES, assertIntegrationRevision } from "../shared/integrationContract";

/**
 * 2026-09-10 真实宿主实测（Codex CLI 0.153.4 挂 Nomi MCP 接 DeepSeek）实锤的六条产品缺陷。
 * 每条一个用例，断言的是「模型照着我们广告的契约走能不能走通」，不是内部实现细节。
 * 完整报告见 docs/plan/2026-09-11-mcp-onboarding-defects.md。
 */

const HOST = "codex" as const;

function makeSessions(dir: string, overrides: ConstructorParameters<typeof IntegrationSessionService>[0] = {}) {
  return new IntegrationSessionService({
    filePath: path.join(dir, "sessions.json"),
    certification: {
      startHttp: vi.fn(async () => ({ id: "run-x", stage: "completed", childRunRef: { runId: "run-x", revisionDigest: "a".repeat(64) } })),
      get: vi.fn(() => ({ id: "run-x", stage: "completed", childRunRef: { runId: "run-x", revisionDigest: "a".repeat(64) } })),
    } as never,
    credentialResolver: () => "stored-key",
    approvalReceiptAuthority: createApprovalReceiptAuthority({
      filePath: path.join(dir, "receipts.json"),
      macKey: "defects-mac-key",
    }),
    save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    enqueueHandoff: () => undefined,
    compilerAvailable: () => true,
    ...overrides,
  });
}

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function toSpendGate(sessions: IntegrationSessionService) {
  const begun = sessions.begin(
    { kind: "http-api-provider", name: "DeepSeek", baseUrl: "https://api.deepseek.com" },
    HOST,
  );
  const proposed = await sessions.propose(begun.id, begun.revision, HOST, {
    candidates: [{ modelKey: "deepseek-flash", kind: "text" }],
    selections: [{ modelKey: "deepseek-flash" }],
  });
  return { id: begun.id, revision: proposed.revision };
}

describe("缺陷 1 · 花费确认不再是死循环", () => {
  it("confirm 在等待期是幂等的：重复调用返回同一枚挑战，不作废人马上要点的那一次", async () => {
    const sessions = makeSessions(tmp("nomi-defect1-"));
    const gate = await toSpendGate(sessions);
    const first = sessions.requestConfirmation(gate.id, gate.revision, HOST, "key-a");
    expect(first.stage).toBe("awaiting_human_confirmation");

    const afterFirst = sessions.get(gate.id, HOST);
    // 不同的 idempotencyKey 也不许重签：Agent 换个键再确认一次是实测里真实发生过的事。
    const second = sessions.requestConfirmation(gate.id, afterFirst.revision, HOST, "key-b");
    expect(second.challengeId).toBe(first.challengeId);
    expect(second.stage).toBe("awaiting_human_confirmation");

    // 人现在才点。挑战还是第一枚，所以这一点是有效的（修复前它已经被作废了）。
    const confirmed = sessions.confirmFromTrustedUi({
      sessionId: gate.id,
      expectedRevision: sessions.get(gate.id, HOST).revision,
      challengeId: first.challengeId,
      webContentsId: 1,
      frameId: 1,
      origin: "file://",
    });
    expect(confirmed.stage).toBe("human_confirmed");
  });

  it("stage 分得清「等人点」和「人点完了」，start 只在后者放行", async () => {
    const sessions = makeSessions(tmp("nomi-defect1b-"));
    const gate = await toSpendGate(sessions);
    const challenge = sessions.requestConfirmation(gate.id, gate.revision, HOST, "key");
    const waiting = sessions.get(gate.id, HOST);
    expect(waiting.stage).toBe("awaiting_human_confirmation");
    await expect(sessions.start(gate.id, waiting.revision, HOST, "key")).rejects.toMatchObject({
      code: "integration_stage_not_allowed",
    });

    sessions.confirmFromTrustedUi({
      sessionId: gate.id,
      expectedRevision: waiting.revision,
      challengeId: challenge.challengeId,
      webContentsId: 1,
      frameId: 1,
      origin: "file://",
    });
    const ready = sessions.get(gate.id, HOST);
    expect(ready.stage).toBe("human_confirmed");
    const started = await sessions.start(gate.id, ready.revision, HOST, "key");
    expect(started.childRunRef?.runId).toBe("run-x");
  });

  it("confirm 的返回给的是相对时间和下一步，不是让模型自己比 UTC", async () => {
    const sessions = makeSessions(tmp("nomi-defect1c-"));
    const gate = await toSpendGate(sessions);
    const challenge = sessions.requestConfirmation(gate.id, gate.revision, HOST, "key");
    expect(challenge.expiresInSeconds).toBeGreaterThan(0);
    expect(Date.parse(challenge.serverTime)).toBeGreaterThan(0);
    expect(challenge.nextAction).toMatch(/do NOT call confirm again/i);
    expect(challenge.expectedRevision).toBe(sessions.get(gate.id, HOST).revision);
  });

  it("花费关的三档由词表派生，不是另抄一份成员清单", () => {
    // isSpendGateStage 用的是「名字里带 confirm」这条判据；这条用例把它钉死，
    // 免得以后新增一个恰好带 confirm 的阶段被静默拉进花费关。
    expect(INTEGRATION_STAGES.filter((stage) => stage.includes("confirm"))).toEqual([
      "needs_spend_confirmation",
      "awaiting_human_confirmation",
      "human_confirmed",
    ]);
  });
});

describe("缺陷 2 · 收据 TTL 从人点下去那一刻起算", () => {
  it("挑战快到期时铸出来的收据仍有完整寿命", () => {
    let clock = Date.parse("2026-09-11T00:00:00.000Z");
    const authority = createApprovalReceiptAuthority({
      filePath: path.join(tmp("nomi-defect2-"), "receipts.json"),
      macKey: "ttl-mac-key",
      now: () => new Date(clock).toISOString(),
    });
    const contract = "c".repeat(64);
    const issued = authority.requestChallenge({
      challengeKey: "gate-1",
      immutableProjectUuid: "uuid",
      projectGeneration: 1,
      projectId: "p",
      runId: "r",
      gateId: "g",
      contractHash: contract,
      targetHash: contract,
      projectRevision: 1,
      costScope: "integration.certification",
      pricingSnapshotHash: contract,
      reservationPreview: { currency: "USD", maximum: 1 },
      display: { model: "m" },
    });
    // 人在挑战只剩 10 秒时才点下确认（实测里「发现 + 翻到设置页」就要这么久）。
    clock = Date.parse(issued.challenge.expiresAt) - 10_000;
    const attestation = authority.createMainProcessGestureAttestation(issued.token, {
      webContentsId: 1, frameId: 1, origin: "file://", decision: "accept",
    });
    const minted = authority.mintReceipt(issued.token, attestation);

    // 修复前：收据继承挑战的 expiresAt，只剩 10 秒——一个 agent 回合都塞不进去。
    expect(Date.parse(minted.receipt.expiresAt)).toBeGreaterThan(Date.parse(issued.challenge.expiresAt));
    expect(Date.parse(minted.receipt.expiresAt) - clock).toBe(5 * 60_000);

    // 挑战早就过期之后，收据仍然可用（人已经批过了，剩下的是 agent 的时间）。
    clock = Date.parse(issued.challenge.expiresAt) + 60_000;
    expect(authority.verifyReceipt(minted.token).receiptId).toBe(minted.receipt.receiptId);
  });
});

describe("缺陷 3 · 项目句柄是短 id，不用模型逐字复述", () => {
  it("对外只发 handleId，签名 token 留在主进程，且短到模型抄得对", () => {
    const authority = createProjectLeaseAuthority({
      macKey: "lease-mac-key",
      store: { revoke: vi.fn(), isRevoked: () => false } as never,
      verifyProjectIdentity: async () => ({
        projectId: "p1", immutableProjectUuid: "u1", projectGeneration: 1, canonicalRootDigest: "d".repeat(64),
      }),
    });
    const issued = authority.issueSelectionHandle({
      projectId: "p1",
      immutableProjectUuid: "u1",
      projectGeneration: 1,
      canonicalRootDigest: "d".repeat(64),
      manifestDigest: "m".repeat(64),
      scopeSet: ["canvas:read"],
    }, { principal: "codex", sessionId: "s1", connectionNonce: "n1" } as never);

    // 实测里模型要复述的是 1271 个字符，从第 514 个字符起就开始分歧。
    expect(issued.token.length).toBeGreaterThan(400);
    expect(issued.handle.handleId.length).toBeLessThanOrEqual(64);
    expect(authority.resolveSelectionHandle(issued.handle.handleId)).toBe(issued.token);
    // 不认识的 id 明说「重新读一次 projects」，而不是含糊地叫人「重新选择项目」。
    expect(() => authority.resolveSelectionHandle("made-up-id")).toThrow(/nomi_read target=projects/);
  });
});

describe("缺陷 4 · schema 的 required 说真话", () => {
  const toolByName = new Map(MODEL_ONBOARDING_TOOLS.map((tool) => [tool.name, tool]));
  /** 每一步的「完整入参」样张：直接用声明自带的 input_examples 第一条（T11：例子必须过自己的 schema）。 */
  const completeFor = (verb: typeof ONBOARDING_VERBS[number]): Record<string, unknown> => ({ ...verb.inputExamples[0] });

  it("声明的必填 = 广播的必填 = 运行时拒的必填（三处同一份，没有第二张表）", () => {
    for (const verb of ONBOARDING_VERBS) {
      const tool = toolByName.get(verb.tool)!;
      const complete = completeFor(verb);
      // ① input_examples 自己先过 schema（例子写错 = 我们教模型写错）。
      expect({ verb: verb.action ?? verb.tool, invalid: validateToolArguments(tool.name, tool.inputSchema, complete) })
        .toEqual({ verb: verb.action ?? verb.tool, invalid: null });
      expect(() => tool.build(complete)).not.toThrow();

      const actionDescription = String(
        (tool.inputSchema.properties as { action?: { description?: string } }).action?.description ?? "",
      );
      for (const field of requiredFor(verb, complete)) {
        const without = { ...complete };
        delete without[field];
        // ② 对外契约说它必填：独立工具写在 schema.required 上，合并工具写在 action 的描述里
        //    （扁平 schema 表达不了条件必填：Anthropic 适配器会丢掉根 allOf，模型会看到一个没有 schema 的工具）。
        const declared = verb.action
          ? actionDescription.includes(field)
          : (tool.inputSchema.required as string[]).includes(field);
        expect({ verb: verb.action ?? verb.tool, field, declared }).toEqual({ verb: verb.action ?? verb.tool, field, declared: true });
        // ③ 运行时真的拒，且是同一份清单。
        expect(() => tool.build(without)).toThrow(new RegExp(field));
      }
    }
  });

  it("缺字段一次列全，而不是逐个抛（实测里 22 次失败有 9 次栽在逐个抛上）", () => {
    const setup = toolByName.get("nomi_model_setup")!;
    expect(() => setup.build({ action: "connect_provider", baseUrl: "https://x" }))
      .toThrow(/missing kind, name/);
    expect(() => setup.build({ action: "show_models", vendorKey: "v" }))
      .toThrow(/missing modelKeys, visible/);
  });

  it("模型面上一个要它自己算的东西都没有：没有 expectedRevision、没有 idempotencyKey", () => {
    for (const tool of MODEL_ONBOARDING_TOOLS) {
      const fields = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect({ tool: tool.name, fields: fields.filter((f) => /^(expectedRevision|idempotencyKey|revision)$/.test(f)) })
        .toEqual({ tool: tool.name, fields: [] });
    }
  });
});

describe("缺陷 5 · revision is stale 拆成各说一件事的码", () => {
  it("缺字段 / 落后 / 超前各有自己的码和可执行细节", () => {
    expect(() => assertIntegrationRevision(undefined, 7)).toThrow(
      expect.objectContaining({ code: "integration_expected_revision_missing" }) as never,
    );
    expect(() => assertIntegrationRevision(3, 7)).toThrow(
      expect.objectContaining({ code: "integration_revision_stale", details: { currentRevision: 7, sentRevision: 3 } }) as never,
    );
    expect(() => assertIntegrationRevision(9, 7)).toThrow(
      expect.objectContaining({ code: "integration_revision_ahead" }) as never,
    );
    expect(() => assertIntegrationRevision(7, 7)).not.toThrow();
  });

  it("每个码在对外错误表里都有中英人话 + 恢复动作 + currentRevision", () => {
    let error: unknown;
    try {
      assertIntegrationRevision(3, 7);
    } catch (value) {
      error = value;
    }
    for (const locale of ["zh-CN", "en"] as const) {
      const outcome = buildToolErrorOutcome("nomi_model_setup", error, locale);
      expect(outcome.outcome.errorCode).toBe("integration_revision_stale");
      expect(outcome.outcome.recoveryActions).not.toHaveLength(0);
      expect(outcome.outcome.details).toEqual({ currentRevision: 7, sentRevision: 3 });
      expect(outcome.text).toContain("currentRevision=7");
      // 修复前这一族是英文裸 Error；现在与 lease_invalid 一族走同一张双语表。
      expect(outcome.text.startsWith("✗")).toBe(true);
    }
  });
});

describe("缺陷 6 · 会话可枚举、可复用、不重复要 key", () => {
  it("nomi_list_models 不带参数时列出本客户端的在途接入（上下文丢了也找得回来）", async () => {
    const sessions = makeSessions(tmp("nomi-defect6-"));
    const ctx = { integrationSessions: sessions, origin: { host: HOST } } as never;
    const mine = sessions.begin({ kind: "http-api-provider", name: "Mine", baseUrl: "https://a.example" }, HOST);
    sessions.begin({ kind: "http-api-provider", name: "Theirs", baseUrl: "https://b.example" }, "claude");
    const listed = await dispatch("modelSetup.list", {}, ctx) as { state: { setups: Array<{ id: string }> } };
    expect(listed.state.setups.map((entry) => entry.id)).toEqual([mine.id]);
  });

  it("begin 命中已有会话时复用，不再造第二个；已存 key 的 baseUrl 不再报 missing", () => {
    const sessions = makeSessions(tmp("nomi-defect6b-"));
    const first = sessions.begin({ kind: "http-api-provider", name: "DeepSeek", baseUrl: "https://api.deepseek.com/" }, HOST);
    expect(first.credentialStatus).toBe("ready");
    expect(first.stage).toBe("draft");
    const again = sessions.begin({ kind: "http-api-provider", name: "DeepSeek again", baseUrl: "https://api.deepseek.com" }, HOST);
    expect(again.id).toBe(first.id);
    const byId = sessions.begin({ kind: "http-api-provider", name: "ignored", baseUrl: "https://elsewhere.example", sessionId: first.id }, HOST);
    expect(byId.id).toBe(first.id);
  });

  it("没有凭据的 baseUrl 仍然如实停在 needs_credential", () => {
    const sessions = makeSessions(tmp("nomi-defect6c-"), { credentialResolver: () => undefined });
    const begun = sessions.begin({ kind: "http-api-provider", name: "Fresh", baseUrl: "https://fresh.example" }, HOST);
    expect(begun.stage).toBe("needs_credential");
    expect(begun.credentialStatus).toBe("missing");
  });
});
