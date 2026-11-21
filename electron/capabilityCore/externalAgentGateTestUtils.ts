/**
 * 外部 Agent「交卡 → 正式生成走到等确认」那条路的测试共用件（只给测试用）。
 *
 * 和宿主同一种接线：生成工具拿的是 `createLiveGenerationRuntime()` 的 `registry`（应用内与 stdio 两个宿主
 * 都这么接，见 `liveGenerationRuntime.ts`）。工具调用走真实的 MCP 工具表 → 参数校验 → dispatcher，
 * 和外部 Agent 发 tools/call 是同一条路；只打本机假地址，不出网、不花钱。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MCP_TOOL_RESOLVER } from "./mcpToolCatalog";
import { validateToolArguments } from "./mcpProtocol";
import { dispatch } from "./dispatcher";
import { runTask } from "../runtime";
import { createLiveGenerationRuntime, type LiveGenerationRuntime } from "./liveGenerationRuntime";
import { ensureBuiltinModelSeeds } from "../catalog/catalogStore";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";

export const FAKE_KEY = "sk-fake-local-key";

const lease: ProjectLeaseV2 = {
  version: PROJECT_LEASE_VERSION, keyId: "k", algorithm: PROJECT_LEASE_ALGORITHM, issuer: "nomi-main", nonce: "n", scopeHash: "s", mac: "m",
  projectId: "project-1", immutableProjectUuid: "uuid-1", projectGeneration: 1, canonicalRootDigest: "r", manifestDigest: "m",
  issuedAt: "2026-11-16T00:00:00.000Z", expiresAt: "2026-11-16T01:00:00.000Z", audience: PROJECT_LEASE_AUDIENCE,
  leasePrincipal: "mcp:codex", sessionId: "s", connectionNonce: "c", revocationEpoch: 0,
  scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:read", "generation:cancel"],
};

type Reply = Record<string, unknown> & { threw?: string; code?: string };

/** 外部 Agent 发一次 tools/call（工具表 → 参数校验 → dispatcher）。 */
export async function callTool(name: string, args: Record<string, unknown>): Promise<Reply> {
  const tool = MCP_TOOL_RESOLVER.resolve(name)!;
  const invalid = validateToolArguments(tool.name, tool.inputSchema, args);
  if (invalid) return { threw: String(invalid.message), code: "invalid_args" };
  const method = typeof (tool as { resolveMethod?: unknown }).resolveMethod === "function"
    ? (tool as unknown as { resolveMethod: (a: Record<string, unknown>) => string }).resolveMethod(args) : tool.method;
  try {
    return await dispatch(method, tool.build(args) as Record<string, unknown>, {
      origin: { host: "codex" }, runTask, approvalPolicy: () => ({ mode: "request" }),
    } as never) as Reply;
  } catch (error) {
    return { threw: String((error as Error)?.message || error), code: (error as { code?: string }).code };
  }
}

export async function rawDispatch(method: string, params: Record<string, unknown>): Promise<Reply> {
  try { return await dispatch(method, params, { origin: { host: "codex" }, runTask } as never) as Reply; }
  catch (error) { return { threw: String((error as Error)?.message || error), code: (error as { code?: string }).code }; }
}

// 这个文件会跟着主进程一起编译进 dist-electron（只排除 *.test.ts），所以不 import vitest：
// 资料目录自己换、自己还原，测试在 afterEach 里调 `restoreSettingsDir()`。
let settingsDirBefore: { value: string | undefined } | null = null;
function pointSettingsDirAt(dir: string): void {
  if (!settingsDirBefore) settingsDirBefore = { value: process.env.NOMI_SETTINGS_DIR };
  process.env.NOMI_SETTINGS_DIR = dir;
}

/** 把资料目录还原成换之前的样子（测试 afterEach 用）。 */
export function restoreSettingsDir(): void {
  if (!settingsDirBefore) return;
  if (settingsDirBefore.value === undefined) delete process.env.NOMI_SETTINGS_DIR;
  else process.env.NOMI_SETTINGS_DIR = settingsDirBefore.value;
  settingsDirBefore = null;
}

/** 一个干净的资料目录，并「打开一次应用」（启动种子）。 */
export function freshSettingsDir(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-gate-${tag}-`));
  pointSettingsDirAt(dir);
  ensureBuiltinModelSeeds();
  return dir;
}

/** 把一份旧版本落的设置目录拷到临时位置并当成这次的资料目录（不改仓库里的文件）。 */
export function openOldUserDir(fixtureDir: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-gate-old-"));
  fs.cpSync(fixtureDir, dir, { recursive: true });
  pointSettingsDirAt(dir);
  return dir;
}

/** 挂到某条连接上的一张视频声明卡。 */
export function videoCard(baseUrl: string, modelKey: string, extra: Record<string, unknown> = {}): string {
  const source = "https://docs.example.test/api";
  return JSON.stringify({
    provider: { baseUrl, authType: "bearer", authHeader: "Authorization" },
    sources: [{ url: source, evidence: "POST /v1/videos -> {task_id}" }],
    assetIngestion: { strategy: "none", sourceUrl: source },
    models: [{
      modelKey, labelZh: modelKey, kind: "video",
      modes: [{
        taskKind: "text_to_video", delivery: "asynchronous",
        create: { method: "POST", path: "/v1/videos", body: { prompt: "{{request.prompt}}" }, response_mapping: { task_id: "task_id", status: "status" }, provider_meta_mapping: { task_id: "task_id" } },
        query: { method: "GET", path: "/v1/videos/{{providerMeta.task_id}}", response_mapping: { task_id: "task_id", status: "status", video_url: "video_url" } },
        statusMapping: { failed: ["error"] }, sourceUrls: [source],
      }],
    }],
    ...extra,
  });
}

/**
 * 规划逻辑接上**真目录**（盘上那一份，每次调用取一版），别的什么都不接：没有准备授权、没有开拍、没有落画布。
 * 它测的是「目录里有什么，起草 / 预览 / 过门就认什么」，**不是**宿主的接线——宿主的接线只在生成装配工厂里
 * （`generationDomain.ts`），由真窗口走查 `tests/ux/mcp-declared-model-gate.e2e.mjs` 在两个宿主上各走一遍来守。
 */
export function liveCatalogPlanning(runtime: LiveGenerationRuntime = createLiveGenerationRuntime()) {
  const handler = createGenerationPlanningHandler({
    catalog: runtime,
    operations: createInMemoryGenerationOperationStore(),
    now: () => "2026-11-16T00:00:00.000Z",
  });
  const call = async (capability: string, params: Record<string, unknown>): Promise<Reply> => {
    try { return await handler({ capability, params, lease } as never) as Reply; }
    catch (error) { return { threw: String((error as Error)?.message || error), code: (error as { code?: string }).code }; }
  };
  return { runtime, call };
}

/** 建草稿 → 预览 → 过门（request）。返回三步各自的回话。 */
export async function draftPreviewGate(planning: ReturnType<typeof liveCatalogPlanning>, input: { providerId: string; modelId: string; mode: string }) {
  const created = await planning.call("create", { candidate: { candidateId: "c1", revision: 1, moduleId: "generation.single-shot", providerId: input.providerId, modelId: input.modelId, mode: input.mode, prompt: "a red apple", parameters: {}, references: [] } });
  const operationId = (created.operation as { operationId?: string } | undefined)?.operationId;
  if (!operationId) return { created, preview: null, gate: null };
  const preview = await planning.call("preview", { operationId });
  const gate = await planning.call("gate_request", { operationId });
  return { created, preview, gate };
}

export function readinessOf(vendorKey: string) {
  return createLiveGenerationRuntime().current().bootstrap.readinessByProvider[vendorKey];
}
