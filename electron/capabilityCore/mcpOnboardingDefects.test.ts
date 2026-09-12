import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { dispatch } from "./dispatcher";
import { validateToolArguments } from "./mcpArgValidation";
import { buildToolErrorOutcome } from "./mcpToolErrorResults";
import { INTEGRATION_REQUIRED_BY_ACTION, MCP_INTEGRATION_TOOL } from "./mcpIntegrationTools";
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
  // 名字留着是因为它仍然是「提完方案的那一刻」；那一刻现在叫 ready_to_certify。
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

describe("缺陷 1 · 花费确认这一关整个不存在了", () => {
  /**
   * 2026-09-12 用户拍板：接模型**没有付费验证**，因此**没有花费确认**——任何路径都没有。
   * 这一关原本要靠三个 stage、一枚签名挑战、一次真人手势和一张收据才走得完，而它唯一的出口
   * （`startConfirmedFromTrustedUi`）第一行就写死 `ownerClientId === "nomi"`：
   * 外部宿主的会话**永远**出不来（2026-09-12 真实验收 §P0-1，Codex 连问三回合只能停下）。
   *
   * 下面三条钉的是「它真的没了」，不是「它修好了」。
   */
  it("提完方案就能自己开跑：外部宿主一路到底，中间没有谁要点头", async () => {
    const sessions = makeSessions(tmp("nomi-defect1-"));
    const ready = await toSpendGate(sessions);
    expect(sessions.get(ready.id, HOST).stage).toBe("ready_to_certify");
    const started = await sessions.start(ready.id, ready.revision, HOST, "key");
    expect(started.childRunRef?.runId).toBe("run-x");
    expect(sessions.get(ready.id, HOST).stage).toBe("completed");
  });

  it("词表里再也没有带 confirm 的阶段", () => {
    // 旧判据是「名字里带 confirm 就是花费关」。花费关没了，这条判据要连同成员一起是空的——
    // 哪天有人再引进一个带 confirm 的阶段，这条用例先红。
    expect(INTEGRATION_STAGES.filter((stage) => stage.includes("confirm"))).toEqual([]);
    expect(INTEGRATION_STAGES).not.toContain("needs_spend_confirmation");
  });

  it("旧盘上停在花费确认的会话被读成「该跑自检了」，不是读崩也不是永远卡着", async () => {
    // 被那条死路卡住的人，升级后要能直接走出来（迁移在 integrationSessionRecord 里）。
    const dir = tmp("nomi-defect1c-");
    const sessions = makeSessions(dir);
    const stuck = await toSpendGate(sessions);
    const file = path.join(dir, "sessions.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { sessions: Array<Record<string, unknown>> };
    raw.sessions[0].stage = "needs_spend_confirmation";
    raw.sessions[0].pendingChallengeId = "challenge-from-the-old-world";
    raw.sessions[0].pendingReceiptId = "receipt-from-the-old-world";
    fs.writeFileSync(file, JSON.stringify(raw));

    const reopened = makeSessions(dir);
    const revived = reopened.get(stuck.id, HOST);
    expect(revived.stage).toBe("ready_to_certify");
    expect(JSON.stringify(revived)).not.toContain("old-world");
    await expect(reopened.start(stuck.id, revived.revision, HOST, "key")).resolves.toMatchObject({ stage: "completed" });
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
  it("每个声明必填的字段缺席时实现真的拒；非必填缺席时真的能跑", async () => {
    const integration = MCP_INTEGRATION_TOOL;
    const missing = (args: Record<string, unknown>) =>
      validateToolArguments(integration.name, integration.inputSchema, args) !== null;
    const actionDescription = String(
      (integration.inputSchema.properties as { action: { description?: string } }).action.description || "",
    );

    for (const [action, required] of Object.entries(INTEGRATION_REQUIRED_BY_ACTION)) {
      const dir = tmp(`nomi-defect4-${action}-`);
      const sessions = makeSessions(dir);
      const ctx = { integrationSessions: sessions, origin: { host: HOST } } as never;
      const gate = await toSpendGate(sessions);
      const complete: Record<string, unknown> = {
        action,
        ...(action === "begin"
          ? { kind: "http-api-provider", name: "Other", baseUrl: "https://other.example" }
          : { sessionId: gate.id, expectedRevision: gate.revision }),
        ...(action === "propose"
          ? { proposal: { candidates: [{ modelKey: "m", kind: "text" }], selections: [{ modelKey: "m" }] } }
          : {}),
        ...(action === "confirm" || action === "start" ? { idempotencyKey: "k" } : {}),
      };
      const declared = action === "begin" ? [...required, "baseUrl"] : [...required];

      // 完整入参过 schema，也过工具层。
      expect({ action, ok: missing(complete) }).toEqual({ action, ok: false });
      expect(() => integration.build(complete)).not.toThrow();

      for (const field of declared) {
        const withoutField = { ...complete };
        delete withoutField[field];
        // ① 对外契约说它必填（扁平 schema 表达不了条件必填——见 mcpIntegrationTools.ts 的说明，
        //    Anthropic 适配器会丢掉根 allOf——所以真话写在 action 的描述里，并由工具层执行）。
        expect({ action, field, declared: actionDescription.includes(field) })
          .toEqual({ action, field, declared: true });
        expect(() => integration.build(withoutField)).toThrow(new RegExp(field));
        // ② 实现真的拒（绕过工具层的聚合校验，直接打到服务端）。
        const method = integration.resolveMethod(withoutField);
        const params = { ...withoutField };
        delete params.action;
        await expect(dispatch(method, params, ctx)).rejects.toBeInstanceOf(Error);
      }
    }
  });

  it("缺字段一次列全，而不是逐个抛（实测里 22 次失败有 9 次栽在逐个抛上）", () => {
    expect(() => MCP_INTEGRATION_TOOL.build({ action: "begin", kind: "http-api-provider" }))
      .toThrow(/missing name, baseUrl/);
    expect(() => MCP_INTEGRATION_TOOL.build({ action: "start", sessionId: "s" }))
      .toThrow(/missing expectedRevision, idempotencyKey/);
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
      const outcome = buildToolErrorOutcome("nomi_integration", error, locale);
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
  it("nomi_read target=integration 不带 sessionId 时列出本客户端的会话", async () => {
    const sessions = makeSessions(tmp("nomi-defect6-"));
    const ctx = { integrationSessions: sessions, origin: { host: HOST } } as never;
    const mine = sessions.begin({ kind: "http-api-provider", name: "Mine", baseUrl: "https://a.example" }, HOST);
    sessions.begin({ kind: "http-api-provider", name: "Theirs", baseUrl: "https://b.example" }, "claude");
    const listed = await dispatch("integration.get", {}, ctx) as { sessions: Array<{ id: string }> };
    expect(listed.sessions.map((entry) => entry.id)).toEqual([mine.id]);
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
