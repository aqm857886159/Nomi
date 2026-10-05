import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { dispatch } from "./dispatcher";
import { validateToolArguments } from "./mcpProtocol";
import { MCP_TOOL_RESOLVER } from "./mcpToolCatalog";
import { IntegrationSessionService } from "../integrationCertification/integrationSession";

/**
 * R13 · 零额度 loopback 夹具：按一次真实接入的顺序把**对外那一面**从头走一遍。
 *
 * 为什么要它：2026-09-10 那次真实实验的两个数字是「入参一次写对 36/58 = 62%」「9 个回合只有
 * 1 个完全成功」，而其余 e2e 全都用 JS 变量直传句柄和入参（完美复制、永远不会写错），把这一族
 * 问题整个测没了。这里换一种口径：**每一步的入参都先按对外广播的 JSON Schema 校验一次**，
 * 校验通过才允许派发。一次写对率 = 首次校验通过的步数 / 总步数。它测的不是模型聪不聪明，
 * 而是「照着我们广告的契约一步步走，能不能走通」。
 *
 * 2026-09-18（#754）：被驱动的那一面换成 `nomi_model_setup` / `nomi_remove_provider`
 * （手写的 `nomi_integration` / `nomi_integration_manage` 同 commit 删除）。这一面比旧面少两样
 * 东西，而它们正是旧实验里烧掉回合最多的两样：
 *   · `expectedRevision` 不再是模型入参（它是会话指纹，由执行层现读现填）；
 *   · 「提案 → 确认 → 跑自检」三跳合成一跳 `submit_declaration`（自检是收卡的一部分）。
 *
 * 2026-09-21：这一轮又少两样，而它们是实测里把四个模型全挡在「声明」之前的那两样——
 *   · 句柄与阶段（`setupId`）不再存在：整份卡自带身份，一跳登记；
 *   · 「先有 key 才能提交」不再成立：这一轮**先交卡、后贴 key**，顺序反过来照样走得通。
 * 所以这个 loopback 现在按新顺序走：读套件 → 交整份卡（无 key）→ 用户贴 key → 读回来。
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
  // 这个服务的选项叫 `filePath`，不是 `dir`（`integrationSession.ts` 的 `Dependencies`）。
  // 整个对象上原先套了一层 `as never`，于是编译器对这个不存在的键一个字都没说，服务退回默认值
  // —— **用户真实的** `~/.nomi/capability-core/integration-sessions.json`。这份测试因此会读到
  // 用户本人的会话；他那份有 101 条、超过 MAX_SESSIONS=100，于是它在这台机器上红，在别的机器上绿。
  // 测试不许读写用户真实目录：给足真路径，`as never` 只留在那两个确实需要放宽的成员上。
  const sessions = new IntegrationSessionService({
    // 会话文件必须落在这个临时目录里：不传 filePath 时服务写的是真实的 ~/.nomi/capability-core，
    // 测试会污染用户资料，而且那份文件一过 100 条会话上限，这条测试就在那台机器上永远红。
    filePath: path.join(dir, "integration-sessions.json"),
    certification: certification as never,
    credentialResolver: (() => ({ apiKey: "sk-loopback", vendorKey: "deepseek" })) as never,
    compilerAvailable: () => true,
  });
  return { sessions, certification };
}

describe("接模型对外面 · 零额度 loopback", () => {
  it("照着广播的契约一步步走，全程零 schema 打回", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-onboarding-loopback-"));
    const { sessions } = makeService(dir);
    const ctx = { integrationSessions: sessions, origin: { host: HOST } } as never;

    const setupTool = MCP_TOOL_RESOLVER.resolve("nomi_model_setup");
    const readTool = MCP_TOOL_RESOLVER.resolve("nomi_read");
    const removeTool = MCP_TOOL_RESOLVER.resolve("nomi_remove_provider");
    expect(setupTool).toBeDefined();
    expect(readTool).toBeDefined();
    expect(removeTool).toBeDefined();

    const attempted: Step[] = [];
    const rejectedBySchema: string[] = [];

    /** 宿主的一跳：先按对外 schema 校验入参，再按 build/resolveMethod 派发。 */
    async function call(tool: NonNullable<typeof readTool>, args: Record<string, unknown>) {
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

    const setup = setupTool!;
    const read = readTool!;

    // ⓪ 读套件：**无任何前置**——没有会话、没有密钥、没有前一跳。
    const kit = await call(read, { target: "onboarding_kit" }) as {
      contractSchema: Record<string, unknown>;
      instructions: string;
      examples: Array<{ name: string; card: unknown }>;
    };
    expect(kit.contractSchema).toHaveProperty("$schema");
    expect(kit.examples.length).toBeGreaterThanOrEqual(2);
    expect(kit.instructions.length).toBeGreaterThan(200);

    // ① 交整份卡：**没有 setupId，也还没有任何 key**。这一跳做完形状校验 + 同源 + 登记。
    const submitted = await call(setup, {
      action: "submit_declaration",
      name: "DeepSeek",
      declaration: JSON.stringify({
        provider: { baseUrl: "https://api.deepseek.com", authType: "bearer", authHeader: "Authorization" },
        sources: [{ url: "https://api-docs.deepseek.com/images", evidence: "POST /images returns data[0].url" }],
        assetIngestion: { strategy: "none", sourceUrl: "https://api-docs.deepseek.com/images" },
        models: [{
          modelKey: "deepseek-paint",
          labelZh: "DeepSeek Paint",
          kind: "image",
          modes: [{
            taskKind: "text_to_image",
            delivery: "synchronous",
            create: {
              method: "POST",
              path: "/images",
              body: { prompt: "{{request.prompt}}" },
              response_mapping: { image_url: "data.0.url" },
            },
            sourceUrls: ["https://api-docs.deepseek.com/images"],
          }],
        }],
      }),
    }) as {
      ok: boolean; vendorKey: string;
      state: { hasApiKey: boolean };
      unverified: Array<{ claim: string }>;
      blastRadius: { modelsAppearing: number; outboundRequests: Array<{ billable: boolean }> };
      nextAction: { kind: string };
    };
    expect(submitted.ok).toBe(true);
    expect(submitted.blastRadius.modelsAppearing).toBe(1);
    // 卡收下了，但这条连接还没有 key——信封如实说，并把下一步指向贴 key 页。
    expect(submitted.state.hasApiKey).toBe(false);
    expect(submitted.nextAction.kind).toBe("user_sees_key_page");
    // 登记这一跳**恒不计费**：花钱的动作只有 nomi_try_model 那一个，而它是另一个契约。
    expect(submitted.blastRadius.outboundRequests.every((request) => request.billable === false)).toBe(true);
    // 自检过了也消不掉这一条：只有一次真实生成才能。
    expect(submitted.unverified.map((entry) => entry.claim)).toContain("model_produces_output");

    // ② 打开贴 key 页：Nomi 没在跑时**不许说「已经打开了」**（2026-09-21 K3：同一封信里
    //    一句说已打开、另一句说 Nomi 没在运行，AI 会照着前半句对用户撒谎）。
    const connected = await call(setup, {
      action: "connect_provider",
      vendorKey: submitted.vendorKey,
      reissueKey: true,
    }) as { ok: boolean; setupId: string; changes: Array<{ summary: string }>; nextAction: { kind: string } };
    expect(connected.ok).toBe(true);
    expect(connected.nextAction.kind).toBe("waiting_for_user");
    expect(connected.changes[0]!.summary).not.toContain("Opened");

    // ②' 用户在那一页粘了密钥并保存——**这一步模型做不到，也不该做得到**。
    sessions.markCredentialReady(connected.setupId, "catalog-deepseek", HOST);

    // ③ 上下文丢了也能找回来：不带 setupId 列出接入会话。
    const listed = await call(read, { target: "setup" }) as { sessions: Array<{ id: string }> };
    expect(listed.sessions.map((entry) => entry.id)).toContain(connected.setupId);

    // ④ 删除要指纹：`nomi_read target=models` 给什么，`ifUnchanged` 就填什么（同一个函数算的）。
    const models = await call(read, { target: "models" }) as { fingerprint: string };
    expect(models.fingerprint).toMatch(/^models-[0-9a-f]{12}$/);

    // 入参一次写对率：这一整轮里没有任何一步被对外 schema 打回。
    const firstTryRate = (attempted.length - rejectedBySchema.length) / attempted.length;
    expect(rejectedBySchema).toEqual([]);
    expect(firstTryRate).toBeGreaterThanOrEqual(0.9);
    // 走完一整条接入要几跳：读套件 + 交卡 + 开贴 key 页 + 找回会话 + 读模型清单 = 5。
    // 上限钉死在这里，是因为「步数」正是这条路上唯一的衡量标准（用户 09-21 的裁决）：
    // 2026-09-21 实测 14 次调用、0 个模型登记成，砍掉的每一跳都是一道墙。
    expect(attempted.length).toBe(5);
  });

  it("陈旧指纹的删除被拒，且什么都没删（撤不回的那一格必须先证明你看的是现在）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-onboarding-remove-"));
    const { sessions } = makeService(dir);
    const ctx = { integrationSessions: sessions, origin: { host: HOST } } as never;
    const removeTool = MCP_TOOL_RESOLVER.resolve("nomi_remove_provider")!;
    const args = { vendorKey: "deepseek", ifUnchanged: "models-000000000000" };
    expect(validateToolArguments(removeTool.name, removeTool.inputSchema, args)).toBeNull();
    const refused = await dispatch(removeTool.method, removeTool.build(args) as Record<string, unknown>, ctx) as { ok: boolean; code: string };
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("stale_fingerprint");
  });
});
