/**
 * 「确定没离开本机」的尝试：释放镜头认领、可以直接重试；说不清的一律仍进对账（L-claim，2026-10-06）。
 *
 * 现象（V-1042 第 22 张截图）：参考卡第一次生成被出网闸拦下，请求根本没出本机；用户换了模型点「重试」，
 * 被认领拒成 needs_reconcile，卡面只写「生成失败」。根因：提交出口只从**最后那个错误的 cause 链**里找
 * 「没写出去」的证据，在本机就被拦下的失败（出网策略、请求头、密钥、网络设置……）错误里没有任何连接证据，
 * 一律落成「结果未知」。修法：由网络出口（appFetch）给每次付费派发记账，判据只在
 * `outboundDispatchEvidence.observeSubmissionHandoffs`。
 *
 * 矩阵：失败种类 × 入口，逐格断言 ①认领释放还是对账 ②能不能立即重试 ③供应商一共收到几笔（防双扣）④失败面说什么。
 * 真实边界：真 Run 仓库 / 真认领判定 / 真提交出口 / 真意向日志；出站走真 vendorHttp（引擎 A）或真目录执行器 send（引擎 B）
 * → appFetch 的记账（单测里 appFetch 换成全局 fetch，但记账是同一个函数）→ 真 undici → 本机回环供应商。零花费。
 *
 * 变异（必须红）：
 *   · 把「确定没发出 → 释放」改回旧行为（observeSubmissionHandoffs 只认 cause 链）→ 「本机被拦」各格红；
 *   · 把「发出后网络断」误判成「没发出」（例如账本不看已交出的请求）→ 「发出后断 / 5xx / 先发一笔再被拦」各格红。
 */
import http from "node:http";
import type net from "node:net";
import type { Session } from "electron";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setupCanvasShots, CANVAS_TEST_PROJECT } from "../capabilityCore/canvasShotTestUtils";
import type { CanvasTaskResult, CanvasTransport } from "../capabilityCore/canvasTransportProvider";
import { createCatalogGenerationProvider } from "../capabilityCore/apimartGenerationProvider";
import type { GenerationProvider, GenerationProviderRequestInputV1 } from "../capabilityCore/generationRuntimeAdapter";
import {
  PROJECT_ID, OPERATION_ID, harness, buildActions, draft, resetSpendFixture, advanceClock,
} from "../capabilityCore/agentPanelSpendConfirmTestUtils";
import type { CatalogState, Vendor } from "../catalog/types";
import { requestJson } from "../vendor/vendorHttp";
import { setSubmitOutboundDepsForTests } from "../vendor/vendorOutboundGuard";
import { applySystemProxy } from "../systemProxy";
import { runTaskIpcGuard } from "../tasks/taskIpcGuard";
import { canvasRunIdFor } from "./canvasShotRunIndex";
import { decideShotClaim } from "../shared/decideShotClaim";
import { jobMayHaveReachedProvider, latestJobForShot } from "../shared/productionShotJobs";
import type { ProductionRun } from "./productionRunTypes";
import { classifyGenerationError } from "../../src/workbench/observability/classifyError";

// ── 本机回环供应商 ─────────────────────────────────────────────────────────────────────────────

type Behaviour = "accept" | "reset-after-read" | "server-error" | "reject-400";

const sockets = new Set<net.Socket>();
const servers: http.Server[] = [];

async function loopbackVendor(first: Behaviour) {
  const received: string[] = [];
  let behaviour = first;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method !== "POST") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 200, data: [{ task_id: "t", status: "succeeded" }] }));
        return;
      }
      received.push(Buffer.concat(chunks).toString("utf8"));
      const now = behaviour;
      behaviour = "accept";
      if (now === "reset-after-read") { request.socket.destroy(); return; }
      if (now === "server-error") { response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "upstream exploded" } })); return; }
      if (now === "reject-400") { response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "prompt rejected" } })); return; }
      response.writeHead(200, { "content-type": "application/json", connection: "close" });
      response.end(JSON.stringify({ code: 200, data: [{ task_id: `task-${received.length}`, status: "succeeded" }] }));
    });
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, received };
}

// ── 失败种类 ───────────────────────────────────────────────────────────────────────────────────

type Kind = {
  id: string;
  label: string;
  /** 第一次尝试的回环行为（网络类）；本机类第一次根本到不了回环。 */
  server: Behaviour;
  /** 第一次尝试在本机怎么失败（只用于本机类）；第二次尝试一律正常。 */
  local?: "outbound-policy" | "illegal-header" | "credential-missing" | "fetch-layer-blocked" | "write-then-refused";
  expect: "released" | "reconcile" | "rejected";
  /** 失败面的分类（classifyGenerationError 的 kind）。 */
  face: string;
};

const KINDS: Kind[] = [
  { id: "outbound-policy", label: "出网策略拦（Nomi 自己的出站闸）", server: "accept", local: "outbound-policy", expect: "released", face: "outbound-blocked-submit" },
  { id: "illegal-header", label: "本机准入拒（请求头不合法）", server: "accept", local: "illegal-header", expect: "released", face: "submission-not-sent" },
  { id: "credential-missing", label: "凭据缺失", server: "accept", local: "credential-missing", expect: "released", face: "submission-not-sent" },
  { id: "fetch-layer-blocked", label: "出网闸在连上之前拒（走查闸 / 防火墙）", server: "accept", local: "fetch-layer-blocked", expect: "released", face: "network" },
  { id: "reset-after-read", label: "发出后网络断", server: "reset-after-read", expect: "reconcile", face: "submission-unknown" },
  { id: "server-error", label: "供应商 5xx", server: "server-error", expect: "reconcile", face: "submission-unknown" },
  { id: "reject-400", label: "供应商明确拒绝（400）", server: "reject-400", expect: "rejected", face: "" },
  { id: "write-then-refused", label: "先发出一笔、再在本机被拦（自定义脚本多步）", server: "accept", local: "write-then-refused", expect: "reconcile", face: "submission-unknown" },
];

/** 「那一刻 fetch 层被闸拦下」：形状同真实 undici 拒连（也同走查闸 scripts/walkthrough-network-guard.cjs）。 */
function fetchLayerBlocked(): never {
  const cause = Object.assign(new Error("connect ECONNREFUSED api.vendor.test (blocked)"), { code: "ECONNREFUSED", syscall: "connect" });
  throw Object.assign(new TypeError("fetch failed (blocked by walkthrough network guard)"), { cause });
}

const realFetch = globalThis.fetch;
/** 第一次尝试（用户第一次点）期间这一格的本机失败一直在；用户重试之前处理好了（网络修好 / 密钥补上 / 地址改对）。 */
const phase = { failing: false, local: undefined as Kind["local"] };
const fetchLayerArmed = () => phase.failing && phase.local === "fetch-layer-blocked";

beforeAll(async () => {
  await applySystemProxy({ setProxy: async () => undefined } as unknown as Session, { mode: "off", customUrl: "" });
  // 单测里 appFetch = 全局 fetch（经同一本派发账，见 tests/setup/networkTransport.ts）。这一层就是走查闸装的那一层。
  vi.stubGlobal("fetch", (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (fetchLayerArmed()) fetchLayerBlocked();
    return realFetch(input, init);
  }) as typeof fetch);
});
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  phase.failing = false;
  phase.local = undefined;
  setSubmitOutboundDepsForTests({
    resolve: async (hostname) => (hostname === "api.blocked-vendor.test" ? [{ address: "10.0.0.8", family: 4 as const }] : [{ address: "93.184.216.34", family: 4 as const }]),
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
    isApplicationProxyActive: () => false,
  });
});
afterEach(async () => {
  setSubmitOutboundDepsForTests(null);
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  resetSpendFixture();
});

// ── 引擎 A：画布那台的传输（vendorHttp.requestJson → appFetch）─────────────────────────────────

function engineATransport(origin: string): CanvasTransport {
  const vendor = (baseUrlHint: string) => ({ key: "acme", authType: "bearer", baseUrlHint } as unknown as Vendor);
  const transport = {
    networkTransport: "app-fetch" as const,
    execute: async (payload: { request: { kind: string; prompt: string } }): Promise<CanvasTaskResult> => {
      const local = phase.failing ? phase.local : undefined;
      let base = origin;
      let apiKey = "test-key";
      if (local === "outbound-policy") base = "https://api.blocked-vendor.test";
      if (local === "illegal-header") apiKey = "密钥里混进了中文";
      // 引擎 A 的密钥在 runTask 的模型解析里取（findExecutableModel）；这里是那一步的最小替身——判据不看错误长什么样，
      // 只看这次派发有没有请求交给网络，所以替身的错误文案无关紧要。
      if (local === "credential-missing") throw new Error("acme connection is disabled, missing, or locked");
      if (local === "write-then-refused") {
        // 自定义调用脚本：第一步真发出去了（供应商收下），第二步去了一个出网策略不放行的地址。
        await requestJson(vendor(origin), apiKey, "POST", `${origin}/v1/images/generations`, { Authorization: `Bearer ${apiKey}` }, {}, { prompt: payload.request.prompt, step: 1 });
        base = "https://api.blocked-vendor.test";
      }
      const body = await requestJson(vendor(base), apiKey, "POST", `${base}/v1/images/generations`, { Authorization: `Bearer ${apiKey}` }, {}, { prompt: payload.request.prompt }) as { data: Array<{ task_id: string }> };
      const id = body.data[0].task_id;
      return { id, kind: payload.request.kind, status: "queued", assets: [], raw: body };
    },
    fetchResult: async (input: Record<string, unknown>) => ({ result: { id: String(input.taskId), kind: "text_to_image", status: "running" as const, assets: [], raw: {} } }),
  };
  return transport;
}

/** 渲染层会拿到的那句话：真 IPC 守卫把错误编成结构化标记，再交给真分类器。 */
async function surfaceOf(work: Promise<unknown>): Promise<{ kind: string; reason: string; primary: string; message: string }> {
  try {
    await runTaskIpcGuard({}, async () => work);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = classifyGenerationError(message);
    return { kind: report.kind, reason: report.reason, primary: report.primary, message };
  }
  throw new Error("expected the attempt to fail");
}

function canvasRunOf(repository: ReturnType<typeof setupCanvasShots>["repository"], runRecordId: string) {
  return repository.read(CANVAS_TEST_PROJECT, canvasRunIdFor(runRecordId));
}

function reservationOf(repository: ReturnType<typeof setupCanvasShots>["repository"], run: ProductionRun | null | undefined) {
  if (!run) return undefined;
  const ledger = repository.readBudgetLedger(run.projectId, run.runId);
  return Object.values(ledger.reservations)[0]?.status;
}

// ── 入口 1 / 2：画布节点 与 分镜参考卡（同一个付费口 nomi:tasks:canvas-submit）─────────────────────

const ENTRIES = [
  {
    id: "canvas-node",
    label: "画布节点",
    extras: (_model: string) => ({}),
  },
  {
    id: "storyboard-reference-card",
    label: "分镜参考卡（跨镜头一致，换模型后重试）",
    // V-1042 那张卡的节点身份：anchorId / referenceSheet / storyboardDesignId；重试前换了模型。
    extras: (model: string) => ({ anchorId: "hero", referenceSheet: true, storyboardDesignId: "audit-sb", creationDocumentId: "doc-1", modelKey: model }),
  },
] as const;

describe.each(ENTRIES)("入口：$label", (entry) => {
  it.each(KINDS)("$label", async (kind) => {
    const vendor = await loopbackVendor(kind.server);
    const transport = engineATransport(vendor.origin);
    const fx = setupCanvasShots({ transport });
    const node = `node-${entry.id}`;
    const firstModel = entry.id === "storyboard-reference-card" ? "gpt-image-2" : "img-model";
    phase.failing = true;
    phase.local = kind.local;
    const surface = await surfaceOf(fx.submit(node, "rr-1", "林薇，短发风衣", entry.extras(firstModel)));
    phase.failing = false;
    const run = canvasRunOf(fx.repository, "rr-1");
    const job = run ? [...run.jobs].sort((a, b) => b.attempt - a.attempt)[0] : undefined;
    const firstReceived = vendor.received.length;

    if (kind.expect === "reconcile") {
      expect(job?.status, "说不清：结果未知，进对账").toBe("submission_unknown");
      expect(jobMayHaveReachedProvider(job!), "可能已到过供应商").toBe(true);
      expect(surface.kind, "失败面：可能已被收下、先核对").toBe(kind.face);
      expect(surface.primary, "失败面不给一键重试").toBe("reconcile");
      // 重试（换不换模型都一样）：被认领拒成 needs_reconcile，供应商一笔都没多收。
      const retry = fx.submit(node, "rr-2", "林薇，短发风衣", entry.extras("img-model"));
      await expect(retry).rejects.toMatchObject({ code: "production_shot_claimed", reason: "needs_reconcile" });
      expect(vendor.received.length, "防双扣：重试没有再发一笔").toBe(firstReceived);
      return;
    }

    expect(job?.status, "确定的失败态，不是结果未知").toBe("needs_attention");
    expect(job?.errorCode).toBe(kind.expect === "rejected" ? "provider_rejected" : "provider_not_reached");
    expect(jobMayHaveReachedProvider(job!), "没花钱，也不会再自己发").toBe(false);
    if (run) expect(reservationOf(fx.repository, run), "预留 provider-safe 释放，不是挂成 unsettled").toBe("released");
    if (kind.expect === "released") {
      expect(firstReceived, "确定没离开本机：供应商一笔都没收到").toBe(kind.local === "write-then-refused" ? 1 : 0);
      expect(surface.kind, "失败面说清原因").toBe(kind.face);
      expect(surface.primary, "下一步：处理好直接重试（出网策略这一类先去网络设置）").not.toBe("reconcile");
    }
    // 用户直接重试（参考卡这一格还换了模型）：认领放行，这一次真的发出去，供应商只多收一笔。
    const retried = await fx.submit(node, "rr-2", "林薇，短发风衣", entry.extras("img-model"));
    expect(retried.id).toMatch(/^task-/);
    expect(vendor.received.length, "重试只发一笔").toBe(firstReceived + 1);
  });
});

// ── 入口 3：Agent 付费卡（真目录执行器 = 引擎 B 的 send → appFetch）────────────────────────────

function catalogFor(origin: string): CatalogState {
  const now = "now";
  return {
    version: 11,
    vendors: [{ key: "acme", name: "Acme", enabled: true, baseUrlHint: origin, authType: "bearer", authHeader: "Authorization", createdAt: now, updatedAt: now }],
    models: [{ vendorKey: "acme", modelKey: "acme-image", kind: "image", enabled: true, labelZh: "Acme 图", createdAt: now, updatedAt: now }],
    mappings: [{
      id: "acme-text_to_image", vendorKey: "acme", modelKey: "acme-image", taskKind: "text_to_image", name: "Acme 文生图", enabled: true,
      create: { method: "POST", path: "/v1/images/generations", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" }, response_mapping: { task_id: "data.0.task_id" } },
      query: { method: "GET", path: "/v1/tasks/{{providerMeta.task_id}}", response_mapping: { status: "data.0.status" } },
      createdAt: now, updatedAt: now,
    }],
    apiKeysByVendor: {},
  } as CatalogState;
}

/**
 * 付费卡夹具的目录叫 apimart / image-model；真目录执行器服务的是用户自己接的 acme。这一层只改名字，
 * 构建与发送原样交给真执行器（它的 send 就是付费卡在生产里走的那一个出口）。
 */
function engineBProvider(origin: string): GenerationProvider {
  const local = () => (phase.failing ? phase.local : undefined);
  const inner = createCatalogGenerationProvider({
    vendorKey: "acme",
    resolveConnection: () => (local() === "credential-missing" ? null : { apiKey: local() === "illegal-header" ? "密钥里混进了中文" : "test-key" }),
    catalogReader: () => catalogFor(origin),
  }) as GenerationProvider & { submitWithContext: (request: unknown, key: string, input: GenerationProviderRequestInputV1) => Promise<{ providerTaskId: string; raw?: unknown }> };
  const rename = (input: GenerationProviderRequestInputV1): GenerationProviderRequestInputV1 => ({ ...input, providerId: "acme", modelId: "acme-image", parameters: {} });
  return {
    providerId: "apimart",
    capabilities: inner.capabilities,
    ...(inner.networkTransport ? { networkTransport: inner.networkTransport } : {}),
    buildRequest: (input) => inner.buildRequest(rename(input)),
    submit: async () => { throw new Error("submitWithContext is the production path"); },
    submitWithContext: async (request: unknown, key: string, input: GenerationProviderRequestInputV1) => {
      return inner.submitWithContext(request, key, rename(input));
    },
    query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "image", url: `nomi-local://asset/${PROJECT_ID}/${providerTaskId}.png` }] }),
  } as GenerationProvider;
}

/** 引擎 B 没有提交侧出网策略（另报），也没有多步脚本：这两格不适用，矩阵里如实标出来。 */
const ENGINE_B_KINDS = KINDS.filter((kind) => kind.local !== "outbound-policy" && kind.local !== "write-then-refused");

describe("入口：Agent 付费卡", () => {
  it.each(ENGINE_B_KINDS)("$label", async (kind) => {
    const vendor = await loopbackVendor(kind.server);
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits, { provider: (_id, origin) => engineBProvider(origin) });
    await draft(base);
    advanceClock(1000);
    const card = withWindow.listPendingSpend(PROJECT_ID)[0];
    expect(card, "付费卡在").toBeDefined();
    phase.failing = true;
    phase.local = kind.local;
    await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: card.quoteId }).catch(() => undefined);
    phase.failing = false;
    const run = base.repository.read(PROJECT_ID, OPERATION_ID)!;
    const shotId = run.generationPlan!.candidate.candidateId;
    const job = latestJobForShot(run, shotId)!;
    const firstReceived = vendor.received.length;
    const current = () => base.repository.read(PROJECT_ID, OPERATION_ID)!;
    const again = () => {
      const quote = withWindow.listPendingSpend(PROJECT_ID)[0];
      return quote ? withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: quote.quoteId }).catch(() => undefined) : Promise.resolve(undefined);
    };

    if (kind.expect === "reconcile") {
      expect(job.status, "说不清：结果未知，进对账").toBe("submission_unknown");
      expect(decideShotClaim(run, shotId, "canvas"), "认领不放：这一镜在对账").toMatchObject({ granted: false, reason: "needs_reconcile" });
      expect(firstReceived).toBe(1);
      advanceClock(1000);
      await again();
      expect(vendor.received.length, "防双扣：卡上再点也不会再发一笔").toBe(1);
      return;
    }
    expect(job.status).toBe("needs_attention");
    expect(job.errorCode).toBe(kind.expect === "rejected" ? "provider_rejected" : "provider_not_reached");
    expect(jobMayHaveReachedProvider(job)).toBe(false);
    expect(firstReceived, "确定没离开本机 / 明确拒绝：最多收到被拒的那一笔").toBe(kind.expect === "rejected" ? 1 : 0);
    const ledger = base.repository.readBudgetLedger(PROJECT_ID, OPERATION_ID);
    expect(Object.values(ledger.reservations).map((reservation) => reservation.status), "预留释放").toEqual(["released"]);
    // 直接重试：认领放回画布（付费卡落在画布上的那个节点点一下就是重做这一镜，走画布那个口子，矩阵上半段已验）。
    expect({ ...decideShotClaim(current(), shotId, "canvas") }, "认领释放：画布可以直接重做这一镜").toEqual({ granted: true, holder: "canvas", reason: "terminal" });
    expect(withWindow.listPendingSpend(PROJECT_ID), "这一张卡已经决定过，不会自己再冒出来再发一次").toEqual([]);
    advanceClock(1000);
    await again();
    expect(vendor.received.length, "制作这边不会自己再发一笔").toBe(firstReceived);
  });
});
