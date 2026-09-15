import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IntegrationSessionService } from "./integrationSession";
import {
  assertSessionDeadlineOutlastsRunSettlement,
  createIntegrationSessionReaper,
  INTEGRATION_CERTIFYING_DEADLINE_MS,
  runSettlementCeilingMs,
} from "./integrationSessionTerminal";

/**
 * 「每个接入会话都在有限时间内落终态，cancel 在任何非终态都可达」——这条不变量归
 * `IntegrationSessionService`（会话层）管，本文件就是那一层的测试。
 *
 * 2026-09-11 真机死锁（`docs/plan/2026-09-11-mcp-integration-quality.md`）之后，
 * providerAdapter 那一层已经把 run 的终态保证做齐了（terminalGuarantee.ts：退避重试 +
 * errors.jsonl 旁路 + 看门狗）。但**会话层自己没有终态保证**——它是借 run 的：
 * `syncHttpCertification` 只在「会话是 http-api-provider 且已经有 childRunRef 且那个 run
 * 还在盘上」时才跟着 run 走。三种状态从这个借来的保证下面漏下去：
 *   1. `comfyui-workflow` 会话（压根没有 run，那条免费自检不走 `process()`）
 *   2. `http-api-provider` 会话在「certifying 意图已落盘、startHttp 还没返回」这个窗口里
 *      被打断（进程死 / 宿主换 / startHttp 永不 resolve）——盘上 `certifying` 且无 childRunRef
 *   3. run 记录已被 `deleteRunsForVendors` 删掉（连接被删）而会话还引用着它
 * 这三种里 `cancel` 都**抛异常**，于是用户和驱动 Agent 双双没有出口——正是用户
 * 「接入验证一直转然后全部失败」那条投诉的形状。
 */
describe("integration session terminal guarantee", () => {
  function make(
    overrides: {
      certification?: unknown;
      now?: () => string;
    } = {},
  ) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-terminal-"));
    const filePath = path.join(dir, "sessions.json");
    return {
      filePath,
      service: new IntegrationSessionService({
        filePath,
        ...(overrides.now ? { now: overrides.now } : { now: () => "2026-09-15T00:00:00.000Z" }),
        ...(overrides.certification ? { certification: overrides.certification as never } : {}),
        credentialResolver: () => "secret",
        compilerAvailable: () => true,
        save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
      }),
    };
  }

  function readyComfy(service: IntegrationSessionService, sessionId: string, revision: number) {
    const staged = service.submitWorkflow(sessionId, revision, "codex", JSON.stringify({ a: 1 }), {
      outputNodeId: "9",
      outputKind: "image",
      params: [],
    });
    return service.resolveInput(sessionId, staged.revision, "codex", {});
  }

  async function readyHttp(service: IntegrationSessionService, name = "Relay") {
    const session = service.begin(
      { kind: "http-api-provider", name, baseUrl: "https://api.example/v1" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    const selected = await service.propose(session.id, ready.revision, "codex", {
      candidates: [{ modelKey: "text-1", kind: "text" }],
      selections: [{ modelKey: "text-1" }],
    });
    return { id: session.id, revision: selected.revision };
  }

  it("startHttp 还没返回就想放弃：cancel 必须放人走，不能把人锁在 certifying", async () => {
    // 复现窗口 2：`certifying` 意图已经落盘，`startHttp` 永不 resolve（真机上就是那次
    // 终态写拿不到文件锁 / 上游吊死）。此刻会话没有 childRunRef，借来的保证一条都不适用。
    const certification = { startHttp: vi.fn(() => new Promise(() => {})) };
    const { service } = make({ certification });
    const { id, revision } = await readyHttp(service);
    void service.start(id, revision, "codex", "idem-hang");
    const certifying = service.get(id, "codex");
    expect(certifying.stage).toBe("certifying");
    expect(certifying.childRunRef).toBeUndefined();
    const cancelled = service.cancel(id, certifying.revision, "codex");
    expect(cancelled.stage).toBe("cancelled");
  });

  it("ComfyUI 会话在 certifying 也要能取消（那条免费自检不走 providerAdapter 的 run）", async () => {
    // 复现窗口 1：`certifyComfy` 是一个还在飞的本地 promise。以前这里直接拒绝 cancel，
    // 理由是「撤不掉、怕和随后 resolve 的完成打架」——但打架要靠「终态不许被覆写」来解，
    // 不能靠「不给用户出口」来解。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-comfy-"));
    const service = new IntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      now: () => "2026-09-15T00:00:00.000Z",
      certifyComfy: () => new Promise(() => {}),
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin({ kind: "comfyui-workflow", name: "Local" }, "codex");
    const ready = readyComfy(service, session.id, session.revision);
    expect(ready.stage).toBe("ready_to_certify");
    void service.start(session.id, ready.revision, "codex", "idem-comfy");
    const certifying = service.get(session.id, "codex");
    expect(certifying.stage).toBe("certifying");
    const cancelled = service.cancel(session.id, certifying.revision, "codex");
    expect(cancelled.stage).toBe("cancelled");
  });

  it("已经取消的会话不许被迟到的认证结果复活成 completed", async () => {
    // 放开 cancel 之后必须同时钉死这一条，否则就是用「两个真相」换「一个出口」。
    let settle: (() => void) | undefined;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-late-"));
    const service = new IntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      now: () => "2026-09-15T00:00:00.000Z",
      certifyComfy: () =>
        new Promise((resolve) => {
          settle = () => resolve({ runId: "late", revisionDigest: "b".repeat(64) });
        }),
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin({ kind: "comfyui-workflow", name: "Local" }, "codex");
    const ready = readyComfy(service, session.id, session.revision);
    const started = service.start(session.id, ready.revision, "codex", "idem-late");
    const certifying = service.get(session.id, "codex");
    service.cancel(session.id, certifying.revision, "codex");
    settle?.();
    await started;
    expect(service.get(session.id, "codex").stage).toBe("cancelled");
  });

  it("看门狗把过了认证 deadline 还非终态的会话收成 failed(certification_timed_out)", async () => {
    // 没人按 cancel 的那条路（用户就是关掉窗口走了）。会话层必须自己收尸，
    // 不能像真机那样停在 certifying 等重启。
    const certification = { startHttp: vi.fn(() => new Promise(() => {})) };
    const { service } = make({ certification });
    const { id, revision } = await readyHttp(service);
    void service.start(id, revision, "codex", "idem-reaped");
    expect(service.get(id, "codex").stage).toBe("certifying");
    const reaped = service.sweepExpiredSessions("2026-09-15T00:20:00.000Z");
    expect(reaped).toEqual([id]);
    const after = service.get(id, "codex");
    expect(after.stage).toBe("failed");
    expect(after.blockingReason?.code).toBe("certification_timed_out");
  });

  it("看门狗不碰 deadline 还没到的会话（没根据就不判死）", async () => {
    const certification = { startHttp: vi.fn(() => new Promise(() => {})) };
    const { service } = make({ certification });
    const { id, revision } = await readyHttp(service);
    void service.start(id, revision, "codex", "idem-young");
    expect(service.sweepExpiredSessions("2026-09-15T00:00:30.000Z")).toEqual([]);
    expect(service.get(id, "codex").stage).toBe("certifying");
  });

  it("重启后仍停在 certifying 的会话由启动补偿收掉，不用等用户再点一次", async () => {
    const certification = { startHttp: vi.fn(() => new Promise(() => {})) };
    const { service, filePath } = make({ certification });
    const { id, revision } = await readyHttp(service);
    void service.start(id, revision, "codex", "idem-restart");
    expect(service.get(id, "codex").stage).toBe("certifying");
    // 进程重来一遍：盘上那条 certifying 会话没有任何在飞的 promise 支撑它。
    const reloaded = new IntegrationSessionService({
      filePath,
      now: () => "2026-09-15T00:30:00.000Z",
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    expect(reloaded.resumeInterrupted()).toEqual([id]);
    const after = reloaded.get(id, "codex");
    expect(after.stage).toBe("failed");
    expect(after.blockingReason?.code).toBe("certification_timed_out");
  });

  it("会话 deadline 必须长过子 run 收干净所需的全部时间 —— 这条派生关系是机检的", () => {
    // 不是「拍一个 10 分钟」：会话 deadline 短于 run 的收敛上限时，看门狗会在 run 还有
    // 合法机会成功时先把会话判死，两层给出互相矛盾的结论。所以这条大小关系写死并断言。
    expect(INTEGRATION_CERTIFYING_DEADLINE_MS).toBeGreaterThan(runSettlementCeilingMs());
    expect(() => assertSessionDeadlineOutlastsRunSettlement()).not.toThrow();
    expect(() => assertSessionDeadlineOutlastsRunSettlement(60_000)).toThrow(/must outlast/);
  });

  it("会话看门狗就是 run 那只 TerminalReaper（换尺子不换实现），只按非终态 + 过期判", () => {
    const forced: string[] = [];
    const reaper = createIntegrationSessionReaper({
      activeSessions: () => [
        { id: "terminal", stage: "completed", certifyingDeadlineAt: "2026-09-15T00:00:00.000Z" },
        { id: "no-deadline", stage: "certifying" },
        { id: "young", stage: "certifying", certifyingDeadlineAt: "2026-09-15T01:00:00.000Z" },
        { id: "expired", stage: "committing", certifyingDeadlineAt: "2026-09-15T00:00:00.000Z" },
      ],
      forceTimeout: (id) => forced.push(id),
      now: () => "2026-09-15T00:10:00.000Z",
    });
    expect(reaper.sweep()).toEqual(["expired"]);
    expect(forced).toEqual(["expired"]);
  });
});
