import { ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import type { GenerationPlanningHandler } from "./mcpGenerationTools";
import {
  GenerationResolveErrorCode,
  type GenerationResolvePlanEnvelope,
  type GenerationResolvePlanValue,
} from "../shared/videoCapabilities/planResolutionContracts";

/** GUI 审阅预览用的窄 IPC resolve 通道（切片 2：主进程接 planning seam，候选集同源）。 */
export const GENERATION_RESOLVE_PLAN_CHANNEL = "nomi:generation:resolve-plan";

/** 带结构化 code 的通道错误（信封 ok=false 时原样携带）。 */
export class GenerationResolveError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GenerationResolveError";
    this.code = code;
  }
}

export type GenerationResolveIpcDependencies = {
  /** 能力核已装配的 planning seam（agent/MCP 与 GUI 共用同一实例）；能力核未启动时返回 null。 */
  getGenerationPlanning: () => GenerationPlanningHandler | null;
  /** 当前 committed 项目 id；没有打开项目时返回 null。 */
  getCommittedProjectId: () => string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asErrorCode(error: unknown, fallback: string): string {
  if (error instanceof GenerationResolveError) return error.code;
  if (isRecord(error) && typeof error.code === "string" && error.code.trim()) return error.code;
  return fallback;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 解析顶层请求形状（shot 级深校验交给 seam resolve 分支——与 agent/MCP 同一解析代码，单一真相）。 */
function parseResolveRequest(raw: unknown): { projectId: string; shots: unknown[]; goals?: { allowAdvisoryMerge?: boolean } } {
  if (!isRecord(raw)) throw new GenerationResolveError(GenerationResolveErrorCode.InputInvalid, "resolve 请求必须是对象。");
  const projectId = typeof raw.projectId === "string" ? raw.projectId.trim() : "";
  if (!projectId) throw new GenerationResolveError(GenerationResolveErrorCode.InputInvalid, "resolve 请求缺少 projectId。");
  if (!Array.isArray(raw.shots) || raw.shots.length === 0) {
    throw new GenerationResolveError(GenerationResolveErrorCode.InputInvalid, "resolve 请求需要非空 shots 数组。");
  }
  let goals: { allowAdvisoryMerge?: boolean } | undefined;
  if (raw.goals !== undefined) {
    if (!isRecord(raw.goals)) throw new GenerationResolveError(GenerationResolveErrorCode.InputInvalid, "resolve 请求的 goals 必须是对象。");
    if (typeof raw.goals.allowAdvisoryMerge === "boolean") goals = { allowAdvisoryMerge: raw.goals.allowAdvisoryMerge };
    else if (raw.goals.allowAdvisoryMerge !== undefined) {
      throw new GenerationResolveError(GenerationResolveErrorCode.InputInvalid, "resolve 请求的 allowAdvisoryMerge 必须是布尔值。");
    }
  }
  return { projectId, shots: raw.shots, goals };
}

/** 结构 sanity：resolve 结果必须是四个数组（形状由 seam 单测背书，这里只防线上退化）。 */
function coerceResolveValue(value: unknown): GenerationResolvePlanValue {
  if (!isRecord(value)) throw new GenerationResolveError(GenerationResolveErrorCode.InvalidResult, "生成策略解析结果异常。");
  const { resolvedShots, mergeProposals, splitProposals, planIssues } = value;
  if (!Array.isArray(resolvedShots) || !Array.isArray(mergeProposals) || !Array.isArray(splitProposals) || !Array.isArray(planIssues)) {
    throw new GenerationResolveError(GenerationResolveErrorCode.InvalidResult, "生成策略解析结果缺少必需数组。");
  }
  return {
    resolvedShots: resolvedShots as GenerationResolvePlanValue["resolvedShots"],
    mergeProposals: mergeProposals as GenerationResolvePlanValue["mergeProposals"],
    splitProposals: splitProposals as GenerationResolvePlanValue["splitProposals"],
    planIssues: planIssues as GenerationResolvePlanValue["planIssues"],
  };
}

/**
 * 纯计算核心（可单测，不依赖 Electron）：
 * 1. 顶层请求形状校验（fail-closed，code 稳定）；
 * 2. projectId 必须等于主进程 committed selection（当前打开项目）——防串项目/旧标签页把别的项目镜头喂进来；
 * 3. planning seam 未装配 → unavailable；
 * 4. 调 seam resolve（无 lease：stateless advisory；候选/解析与 agent/MCP 完全同源）。
 */
export async function resolveGenerationPlanForProject(
  deps: Pick<GenerationResolveIpcDependencies, "getGenerationPlanning" | "getCommittedProjectId">,
  raw: unknown,
): Promise<GenerationResolvePlanValue> {
  const request = parseResolveRequest(raw);
  const committedProjectId = deps.getCommittedProjectId();
  if (!committedProjectId) {
    throw new GenerationResolveError(GenerationResolveErrorCode.ProjectStale, "当前没有打开项目，无法生成执行计划。");
  }
  if (request.projectId !== committedProjectId) {
    throw new GenerationResolveError(GenerationResolveErrorCode.ProjectStale, "项目已切换，请基于当前项目重新生成执行计划。");
  }
  const planning = deps.getGenerationPlanning();
  if (!planning) {
    throw new GenerationResolveError(GenerationResolveErrorCode.CoreUnavailable, "生成能力核未就绪，请稍后重试。");
  }
  const value = await planning({
    capability: "resolve",
    params: {
      shots: request.shots,
      ...(request.goals ? { goals: request.goals } : {}),
    },
  });
  return coerceResolveValue(value);
}

/** 把异常映射成 ok=false 信封（code 稳定可 i18n；sender 守卫违规也在此收口）。 */
export function toResolveEnvelopeError(error: unknown): { code: string; message: string } {
  return { code: asErrorCode(error, GenerationResolveErrorCode.Failed), message: errorMessage(error) };
}

/**
 * 注册 GUI resolve 窄 IPC（幂等：先 remove 再 handle，能力核重启不会重复 handle 抛错）。
 * assertTrustedSender 只放行 Nomi 自己的渲染层；非法/串项目/未就绪一律返回 ok=false，不抛裸异常。
 * 返回反注册函数。
 */
export function registerGenerationResolveIpc(deps: GenerationResolveIpcDependencies): () => void {
  ipcMain.removeHandler(GENERATION_RESOLVE_PLAN_CHANNEL);
  ipcMain.handle(GENERATION_RESOLVE_PLAN_CHANNEL, async (event, request: unknown): Promise<GenerationResolvePlanEnvelope> => {
    try {
      assertTrustedSender(event);
      const value = await resolveGenerationPlanForProject(deps, request);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: toResolveEnvelopeError(error) };
    }
  });
  return () => ipcMain.removeHandler(GENERATION_RESOLVE_PLAN_CHANNEL);
}

// ── 桌面装配点（单例）──────────────────────────────────────────────
// 能力核把 planning seam 装进来并（重）注册通道；能力核停止传 null → 卸载。住在本模块而不是
// appIntegration/main.ts：既避免把装配散进 main.ts 巨壳（check:file-sizes 只减不增），也不让
// appIntegration 冲破 800 行硬上限（R9）。committed project getter 由装配方注入（不在此拉
// workspace 依赖链，保持本模块可被 node 单测直接 import）。renderer 侧
// DesktopBridge.generationStrategy.resolvePlan 走的就是这条通道——候选集/决策与 agent/MCP 同源。
let installedPlanningSeam: GenerationPlanningHandler | null = null;
let unregisterNarrowIpc: (() => void) | null = null;

/** 已装配的 planning seam（能力核未启动 = null）。 */
export function getInstalledGenerationPlanning(): GenerationPlanningHandler | null {
  return installedPlanningSeam;
}

/**
 * 装配/卸载 GUI resolve 窄 IPC。seam 就绪即注册；重启（stop→start）先卸载再重注册（幂等）。
 * @param getCommittedProjectId 当前 committed 项目 id 惰性取法（无打开项目返回 null/空串）；
 *   由 appIntegration 注入（它已持有 canvasReadSurfaceRuntime）。卸载时传 null。
 */
export function installGuiResolveNarrowIpc(
  seam: GenerationPlanningHandler | null,
  getCommittedProjectId?: () => string | null,
): void {
  installedPlanningSeam = seam;
  if (unregisterNarrowIpc) {
    unregisterNarrowIpc();
    unregisterNarrowIpc = null;
  }
  if (!seam || !getCommittedProjectId) return;
  unregisterNarrowIpc = registerGenerationResolveIpc({
    getGenerationPlanning: () => installedPlanningSeam,
    getCommittedProjectId,
  });
}
