/**
 * 验收：**接一家 Higgsfield 形状的供应商要几跳**（方案 §12）。
 *
 * 2026-09-21 真机基线（外部宿主脚本驱动 main `1d7c1e2a5`，轨迹在
 * scratchpad/mcp-onboarding/）：**tools/call 14 次 · 被拒 6 次 · 走到真生成 否**，
 * 四个目标模型一个都没登记成。这条测试把同一件事按新形状再走一遍，并把三个数字钉住。
 *
 * ── 它和 mcpOnboardingLoopback.test.ts 的分工 ──────────────────────────────────────
 * 那一条量的是「照着广播的契约走，入参会不会被 schema 打回」；这一条量的是**整条路走不走得完**，
 * 一直走到供应商真的吐出一个产物。所以它起一个真的 loopback HTTP 供应商、用真的 `runTask`
 * （和用户在画布上点一下生成同一条执行器）、并且真的过一次钱闸。
 *
 * ── 钱闸没有被绕过 ───────────────────────────────────────────────────────────────
 * 试跑会花钱，所以它必须问人。这里**模拟的是「用户在 Nomi 窗口里按下了确认」**：装一个假的
 * 渲染层收件人，再从那条回复通道答 `{confirmed:true}`——和真人点那一下走的是同一条路
 * （`rendererBridge` 的来源绑定照判）。不给这个答复，这一跳就该失败，那是设计。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ipcListeners = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, payload: unknown) => void>() }));

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ipcMain: {
      on: (channel: string, handler: (event: unknown, payload: unknown) => void) => ipcListeners.handlers.set(channel, handler),
      handle: () => undefined,
      removeHandler: () => undefined,
    },
    // 桩默认 isEncryptionAvailable=false，于是存 key 这一步会被写门正当地拒掉。
    // 这里给一个**可逆但不是明文**的替身：验收要走完整条路，而盘上不是明文这条仍然被守着。
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
      decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
    },
  };
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("验收 · 接一家 Higgsfield 形状的供应商要几跳（基线 14/6/否）", () => {
  let server: http.Server;
  let origin: string;
  let root: string;
  const calls: Array<{ tool: string; ok: boolean; code?: string }> = [];
  /** 第一条测试登记出来的连接 id（由卡的 baseUrl 派生，不是我们猜的）。 */
  let vendorKey = "";

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-onboarding-acceptance-"));
    server = http.createServer((request, response) => {
      if (request.url === "/art.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(PNG);
        return;
      }
      if (request.method === "POST" && request.url === "/v1/images/generations") {
        // 鉴权头真的到了（这是「key 存进去了、而且按卡声明的方式放」的证据）。
        const auth = String(request.headers.authorization || "");
        response.writeHead(auth.startsWith("Relay ") ? 200 : 401, { "content-type": "application/json" });
        response.end(JSON.stringify(auth.startsWith("Relay ")
          ? { id: "job-1", data: [{ url: `${origin}/art.png` }] }
          : { error: "missing credentials" }));
        return;
      }
      response.writeHead(404).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    vi.stubEnv("NOMI_SETTINGS_DIR", root);
  });

  afterAll(async () => {
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("读套件 → 交整份卡 → 填 key → 试跑，四跳走到产物", async () => {
    const { MCP_TOOL_RESOLVER } = await import("../mcpToolCatalog");
    const { validateToolArguments } = await import("../mcpProtocol");
    const { dispatch } = await import("../dispatcher");
    const { setRendererTarget, CAPABILITY_APPLY_REPLY_CHANNEL } = await import("../rendererBridge");
    const { runTask } = await import("../../runtime");

    const ctx = { origin: { host: "claude" }, runTask } as never;
    async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      const tool = MCP_TOOL_RESOLVER.resolve(name)!;
      const invalid = validateToolArguments(tool.name, tool.inputSchema, args);
      if (invalid) {
        calls.push({ tool: name, ok: false, code: "schema" });
        throw invalid;
      }
      const method = typeof (tool as { resolveMethod?: unknown }).resolveMethod === "function"
        ? (tool as { resolveMethod: (a: Record<string, unknown>) => string }).resolveMethod(args)
        : tool.method;
      const result = await dispatch(method, tool.build(args) as Record<string, unknown>, ctx) as Record<string, unknown>;
      calls.push({ tool: name, ok: result.ok !== false, ...(typeof result.code === "string" ? { code: result.code } : {}) });
      return result;
    }

    // ① 读套件：无前置。
    const kit = await call("nomi_read", { target: "onboarding_kit" }) as { examples: unknown[] };
    expect(kit.examples.length).toBeGreaterThanOrEqual(2);

    // ② 交整份卡：无句柄、无 key。形状照抄套件里那份异步样例的结构，只是这家是同步的。
    const docs = "https://docs.example-relay.com/api";
    const submitted = await call("nomi_model_setup", {
      action: "submit_declaration",
      name: "Example Relay",
      declaration: JSON.stringify({
        provider: { baseUrl: origin, authType: "bearer", authHeader: "Authorization", authScheme: "Relay" },
        sources: [{ url: docs, evidence: "POST /v1/images/generations returns data[0].url" }],
        assetIngestion: { strategy: "none", sourceUrl: docs },
        models: [{
          modelKey: "relay-paint",
          labelZh: "Relay Paint",
          kind: "image",
          modes: [{
            taskKind: "text_to_image",
            delivery: "synchronous",
            create: {
              method: "POST",
              path: "/v1/images/generations",
              body: { prompt: "{{request.prompt}}" },
              response_mapping: { image_url: "data.0.url" },
            },
            sourceUrls: [docs],
          }],
        }],
      }),
    }) as { ok: boolean; vendorKey: string; state: { hasApiKey: boolean } };
    expect(submitted.ok).toBe(true);
    expect(submitted.state.hasApiKey).toBe(false);
    vendorKey = submitted.vendorKey;

    // ③ 用户把 key 交给了他的 AI，AI 走同一扇写门填进去。
    const keyed = await call("nomi_model_setup", {
      action: "set_key",
      vendorKey: submitted.vendorKey,
      apiKey: "relay-test-key",
    }) as { ok: boolean };
    expect(keyed.ok).toBe(true);

    // ④ 试跑。先把「用户面前有一个 Nomi 窗口」这件事装上，并替他按下确认。
    const sent: Array<{ id: number }> = [];
    const target = {
      id: 42,
      isDestroyed: () => false,
      mainFrame: { routingId: 1 },
      getURL: () => "http://127.0.0.1:5273/index.html",
      send: (_channel: string, payload: { id: number }) => {
        sent.push(payload);
        // 真人点那一下：从同一个 webContents / frame / origin 回复。
        setTimeout(() => {
          ipcListeners.handlers.get(CAPABILITY_APPLY_REPLY_CHANNEL)?.(
            { sender: { id: 42 }, senderFrame: { routingId: 1, url: "http://127.0.0.1:5273/index.html" } },
            { id: payload.id, ok: true, result: { confirmed: true } },
          );
        }, 0);
      },
    };
    setRendererTarget(target as never);
    const tried = await call("nomi_try_model", {
      vendorKey: submitted.vendorKey,
      modelKey: "relay-paint",
      prompt: "a red apple on a white table",
    }) as { ok: boolean; state?: { assets: Array<{ url?: string }>; providerResponse: string } };
    setRendererTarget(null);

    expect(tried.ok, JSON.stringify(tried)).toBe(true);
    expect(tried.state!.assets.length).toBeGreaterThan(0);
    // 供应商原文脱敏后原样回传——AI 自己收敛靠的就是这一段。
    expect(tried.state!.providerResponse).toContain("job-1");
    expect(tried.state!.providerResponse).not.toContain("relay-test-key");
    // 钱闸真的问过人：那张卡发到了窗口上。
    expect(sent.length).toBeGreaterThan(0);

    // ── 三个数字 ──（基线：14 / 6 / 否）
    expect(calls.length).toBeLessThanOrEqual(5);
    expect(calls.filter((entry) => !entry.ok)).toEqual([]);
    expect(tried.ok).toBe(true);
    console.log(`[验收] tools/call=${calls.length} 被拒=${calls.filter((c) => !c.ok).length} 试跑成功=${tried.ok ? 1 : 0}（基线 14 / 6 / 0）`);
  });

  /**
   * 「该不该问人」由**用户的档位**决定，不由入口决定（09-21 用户拍板）。这三条把三种处境各钉一次，
   * 判据全部来自同一个函数 `spendDecidedByPolicy`——试跑不自己再答一遍。
   */
  it("全自动档：不弹卡、直接跑，账本上写着是策略代答的", async () => {
    const { dispatch } = await import("../dispatcher");
    const { setRendererTarget } = await import("../rendererBridge");
    const { runTask } = await import("../../runtime");
    // 窗口**根本不存在**：全自动档下这一跳也必须跑得完，否则「不弹卡」就是假的。
    setRendererTarget(null);
    const tried = await dispatch("model.onboarding.try", {
      vendorKey, modelKey: "relay-paint", prompt: "a second apple",
    }, {
      origin: { host: "claude" },
      runTask,
      approvalPolicy: () => ({ mode: "project", spend: "confirm" }),
    } as never) as { ok: boolean; state?: { spendDecidedBy: string; assets: unknown[] } };
    expect(tried.ok, JSON.stringify(tried)).toBe(true);
    expect(tried.state!.spendDecidedBy).toBe("policy:full_auto");
    expect(tried.state!.assets.length).toBeGreaterThan(0);
  });

  it("非全自动档 + 没有 Nomi 窗口：诚实失败，不偷偷放行", async () => {
    const { dispatch } = await import("../dispatcher");
    const { setRendererTarget } = await import("../rendererBridge");
    const { runTask } = await import("../../runtime");
    setRendererTarget(null);
    const refused = await dispatch("model.onboarding.try", {
      vendorKey, modelKey: "relay-paint", prompt: "a third apple",
    }, {
      origin: { host: "claude" },
      runTask,
      approvalPolicy: () => ({ mode: "step", spend: "confirm" }),
    } as never) as { ok: boolean; code: string; nextAction: string };
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("needs_input");
    expect(refused.nextAction).toMatch(/confirm/i);
  });

  it("模型永远拿不到「替用户批准」的参数：任何 approve/confirm/trust 字段都进不了这张 schema", async () => {
    const { MCP_TOOL_RESOLVER } = await import("../mcpToolCatalog");
    const { validateToolArguments } = await import("../mcpProtocol");
    const tool = MCP_TOOL_RESOLVER.resolve("nomi_try_model")!;
    for (const field of ["approved", "approve", "confirmed", "confirm", "trusted", "trust", "grantId", "receipt", "autoApprove", "skipConfirmation"]) {
      const invalid = validateToolArguments(tool.name, tool.inputSchema, {
        vendorKey, modelKey: "relay-paint", [field]: true,
      });
      expect(invalid, `${field} 不该被这张 schema 接受`).not.toBeNull();
    }
    // 阳性对照：合法入参过得去，所以上面那些红不是因为整张 schema 都在拒。
    expect(validateToolArguments(tool.name, tool.inputSchema, { vendorKey, modelKey: "relay-paint" })).toBeNull();
  });
});
