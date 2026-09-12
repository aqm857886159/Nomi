import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { dispatch } from "./dispatcher";
import { validateToolArguments } from "./mcpArgValidation";
import { MCP_INTEGRATION_TOOL } from "./mcpIntegrationTools";
import { MCP_TOOL_RESOLVER } from "./mcpToolCatalog";
import { IntegrationSessionService } from "../integrationCertification/integrationSession";

/**
 * R30 · 零额度 loopback 夹具：按 2026-09-10 那次真实实验的 Run 9 顺序驱动一遍接模型全流程。
 *
 * 为什么要它：那次实验的两个数字是「入参一次写对 36/58 = 62%」和「9 个回合只有 1 个完全成功」，
 * 而现有 e2e 全都用 JS 变量直传句柄和入参（完美复制、永远不会写错），把这一族问题整个测没了。
 * 这里换一种口径：**每一步的入参都先按对外广播的 JSON Schema 校验一次**，校验通过才允许派发。
 * 一次写对率 = 首次校验通过的步数 / 总步数。它测的不是模型聪不聪明，而是「照着我们广告的契约
 * 一步步走，能不能走通」——修复前答案是不能（schema 上的必填是假的、会话丢了找不回来，
 * 而且外部宿主走到花费确认那一档就**永远出不来**——那一整关已于 2026-09-12 随「接模型不做
 * 付费验证」一起删掉）。
 */

const HOST = "codex" as const;

type Step = { name: string; args: Record<string, unknown> };

function makeService(dir: string) {
  const certification = {
    startHttp: vi.fn(async () => ({
      id: "run-loopback",
      stage: "completed",
      childRunRef: { runId: "run-loopback", revisionDigest: "f".repeat(64) },
    })),
    get: vi.fn(() => ({
      id: "run-loopback",
      stage: "completed",
      childRunRef: { runId: "run-loopback", revisionDigest: "f".repeat(64) },
    })),
  };
  const sessions = new IntegrationSessionService({
    filePath: path.join(dir, "sessions.json"),
    certification: certification as never,
    credentialResolver: () => "loopback-key",
    save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    enqueueHandoff: () => undefined,
    compilerAvailable: () => true,
  });
  return { sessions, certification };
}

describe("MCP model-onboarding loopback (R30)", () => {
  it("replays the Run 9 host script with a >=90% first-try argument rate and a successful turn", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-onboard-loopback-"));
    const { sessions, certification } = makeService(dir);
    const ctx = { integrationSessions: sessions, origin: { host: HOST } } as never;

    const readTool = MCP_TOOL_RESOLVER.resolve("nomi_read");
    expect(readTool).toBeDefined();

    const attempted: Step[] = [];
    const rejectedBySchema: string[] = [];

    /** 宿主的一跳：先按对外 schema 校验入参，再按 build/resolveMethod 派发。 */
    async function call(tool: typeof MCP_INTEGRATION_TOOL | NonNullable<typeof readTool>, args: Record<string, unknown>) {
      attempted.push({ name: tool.name, args });
      const invalid = validateToolArguments(tool.name, tool.inputSchema, args);
      if (invalid) {
        rejectedBySchema.push(`${tool.name}: ${invalid.message}`);
        throw invalid;
      }
      const method = typeof (tool as { resolveMethod?: unknown }).resolveMethod === "function"
        ? (tool as { resolveMethod: (a: Record<string, unknown>) => string }).resolveMethod(args)
        : tool.method;
      return dispatch(method, tool.build(args) as Record<string, unknown>, ctx) as Promise<Record<string, unknown>>;
    }

    const integration = MCP_INTEGRATION_TOOL;
    const read = readTool!;

    // ① 建会话（真实必填：kind + name + baseUrl，schema 现在也这么说）
    const begun = await call(integration, {
      action: "begin",
      kind: "http-api-provider",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      authType: "bearer",
    }) as { id: string; revision: number; stage: string; credentialStatus: string };
    expect(begun.stage).toBe("draft");
    // ② 凭据已经在安全存储里 → 不该再要用户填一遍
    expect(begun.credentialStatus).toBe("ready");

    // ③ 上下文丢了也能找回来：不带 sessionId 列出会话
    const listed = await call(read, { target: "integration" }) as { sessions: Array<{ id: string; revision: number }> };
    expect(listed.sessions.map((entry) => entry.id)).toContain(begun.id);

    // ④ 再 begin 同一个 baseUrl：复用，不再多造一个会话
    const again = await call(integration, {
      action: "begin",
      kind: "http-api-provider",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
    }) as { id: string };
    expect(again.id).toBe(begun.id);

    // ⑤ 读回单个会话，拿最新 revision
    const current = await call(read, { target: "integration", sessionId: begun.id }) as { revision: number };

    // ⑥ 提案（候选 + 选择一次交齐）
    const proposed = await call(integration, {
      action: "propose",
      sessionId: begun.id,
      expectedRevision: current.revision,
      proposal: {
        candidates: [{ modelKey: "deepseek-flash", kind: "text" }],
        selections: [{ modelKey: "deepseek-flash" }],
      },
    }) as { revision: number; stage: string };
    // 提完方案就到「该跑自检了」。这里**没有**第七步：接模型没有付费验证，也就没有花费确认
    // （2026-09-12 用户拍板）。旧版本在这里卡死——外部宿主根本走不出 needs_spend_confirmation
    // （见 docs/research/2026-09-12-real-onboarding-acceptance §P0-1）。
    expect(proposed.stage).toBe("ready_to_certify");

    // ⑦ 直接 start：同一个外部宿主，不需要任何人在 Nomi 里点
    const started = await call(integration, {
      action: "start",
      sessionId: begun.id,
      expectedRevision: proposed.revision,
      idempotencyKey: "loopback-1",
    }) as { stage: string; childRunRef?: { runId: string } };

    expect(started.childRunRef?.runId).toBe("run-loopback");

    // ⑧ 终态
    const final = await call(read, { target: "integration", sessionId: begun.id }) as { stage: string };
    expect(final.stage).toBe("completed");
    expect(certification.startHttp).toHaveBeenCalledTimes(1);

    // 入参一次写对率：这一整轮里没有任何一步被对外 schema 打回。
    const firstTryRate = (attempted.length - rejectedBySchema.length) / attempted.length;
    expect(rejectedBySchema).toEqual([]);
    expect(firstTryRate).toBeGreaterThanOrEqual(0.9);
    expect(attempted.length).toBeGreaterThanOrEqual(7);
  });
});
