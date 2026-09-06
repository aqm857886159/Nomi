// 异步任务「续查」收口（从 runtime.ts 拆出，巨壳门岗·只减不增 R12）。
// 单一真相：缓存命中与无状态重建共用同一段 query。与 runtime 是调用时（函数体内）的循环依赖——
// ESM/CJS 都按 live binding 在调用时取值，加载期不触碰，安全。
import { trim, type JsonRecord } from "../jsonUtils";
import type { Model, ProfileKind } from "../catalog/types";
import { readCatalog } from "../catalog/catalogStore";
import { desktopT } from "../i18n";
import { classifyTaskCacheMiss, wasTaskAdmitted } from "./taskAdmission";
import { taskFailureMessageFromResponse } from "./responseParsing";
import { activeTaskProjectFallback, unlocalizedTaskAsset } from "./activeProjectFallback";
import { traceVendorCompleted } from "../events/vendorCallTrace";
import { extractProviderCostActual } from "../vendor/cost";
import { rememberTaskResult } from "../vendor/fingerprintCache";
import { resolveComfyCandidateExecution } from "../catalog/comfyuiCandidateLifecycle";
import {
  type CachedTask,
  type TaskResult,
  admitTask,
  billingKindForTaskKind,
  buildProfileTaskResult,
  executeProfileOperation,
  extractAssetUrl,
  findExecutableModel,
  findTaskMapping,
  localizeTaskAsset,
  taskCache,
} from "../runtime";
import { logWarn } from "../logging/logger";

// ── 未登记状态动词的有界容忍（根因修复，见 docs/plan/2026-08-11-unrecognized-task-status-root-fix.md）──
//
// 病根：归一时「不认得的动词」曾被压成 queued，而 queued = 「继续轮询」的指令 —— 上游已经返回
// failure/rejected，系统却读成「还在排队」，把预算烧完也没把真因报出来（用户视角 = 永远转圈）。
// 补动词表只是止血，下一个没见过的词照样中招；这里治的是**兜底语义默认乐观**本身。
//
// 判定必须**同时**满足下面两个条件（绝不一见未知就判死）。取舍是不对称的：
//   · 误杀（未知动词其实表示「进行中」）→ 用户损失一次**已付费**的生成，更贵；
//   · 误等（未知动词表示失败）→ 只浪费时间，不丢钱。
// 所以窗口取偏宽的 2 分钟而非几秒；对视频（硬超时 20min）仍是提前一个数量级报错。真误杀了，
// 失败文案也明说「可能仍在上游运行」并带上原始动词，用户能去平台核对、我们能据日志补表。
const UNRECOGNIZED_STATUS_MIN_POLLS = 4;
const UNRECOGNIZED_STATUS_GRACE_MS = 120_000;

/** (vendor, 动词) 去重：轮询每 1.5-3s 一轮，不去重会把日志刷爆。 */
const reportedUnrecognizedStatuses = new Set<string>();

/**
 * 诊断出口：看到这条日志就知道该往哪家的 statusMapping 补哪个词
 * （如 catalog/newapiTransport.ts 的 NEWAPI_STATUS_MAPPING）。
 */
function reportUnrecognizedStatus(cached: CachedTask, taskId: string, verb: string): void {
  const dedupeKey = `${cached.vendor}::${verb.toLowerCase()}`;
  if (reportedUnrecognizedStatuses.has(dedupeKey)) return;
  reportedUnrecognizedStatuses.add(dedupeKey);
  logWarn("tasks", "unregistered-status-verb", {
    verb,
    vendor: cached.vendor,
    model: cached.model?.modelKey || "?",
    kind: cached.request.kind,
    taskId,
  });
}

/**
 * 推进未知动词连击（纯函数，直接可测）。认得的动词 → undefined（清零）。
 *
 * 动词换了**不重新起算时钟**，只更新报错要用的词：否则上游在两个未知动词间来回切，
 * 就能让计时永远归零、绕过判定 —— 那等于这个修复不存在。
 */
export function advanceUnrecognizedStatusStreak(
  previous: CachedTask["unrecognizedStatusStreak"],
  unrecognizedStatus: string,
  now: number,
): CachedTask["unrecognizedStatusStreak"] {
  if (!unrecognizedStatus) return undefined;
  if (!previous) return { verb: unrecognizedStatus, polls: 1, firstSeenAt: now };
  return { verb: unrecognizedStatus, polls: previous.polls + 1, firstSeenAt: previous.firstSeenAt };
}

/** 连击是否已耗尽容忍窗口（次数与时长**都**要够，见上方取舍说明）。 */
export function unrecognizedStatusExhausted(streak: CachedTask["unrecognizedStatusStreak"], now: number): boolean {
  if (!streak) return false;
  return streak.polls >= UNRECOGNIZED_STATUS_MIN_POLLS && now - streak.firstSeenAt >= UNRECOGNIZED_STATUS_GRACE_MS;
}

/**
 * A queue can report COMPLETED while its result endpoint contains no media.
 * Treat that as a terminal failure for async media instead of persisting a
 * misleading succeeded task with an empty asset list. Text tasks and the
 * synchronous audio runner do not pass through this boundary.
 */
export function ensureAsyncMediaOutput(result: TaskResult, wantedKind: string): TaskResult {
  if (result.status !== "succeeded" || !["image", "video", "audio", "model3d"].includes(wantedKind) || result.assets.length > 0) return result;
  return { ...result, status: "failed", error: desktopT("tasks.completedWithoutOutput") };
}

/**
 * 无状态重建续查上下文（治本核心）：内存 taskCache 是 TTL 1h/上限 200/重启即空 的工作缓存，
 * 但续查其实只需 {vendor, modelKey, taskKind, taskId}——mapping/model 都是 catalog 的纯函数产物，
 * providerMeta.task_id 就是持久化的 taskId。渲染层超时找回(重启后也能)把这四个字段喂回来，
 * 据此重建一个等价 CachedTask，走与缓存命中**同一段** query。重建不了(模型没配/无 query op)→ 返回 null。
 */
function rebuildCachedTaskFromPayload(taskId: string, raw: JsonRecord): CachedTask | null {
  const vendorKey = trim(raw.vendor);
  const taskKind = trim(raw.taskKind) as ProfileKind;
  const modelKey = trim(raw.modelKey);
  const modeId = trim(raw.modeId) || (raw.archetype && typeof raw.archetype === "object" ? trim((raw.archetype as JsonRecord).modeId) : "");
  if (!vendorKey || !taskKind || !modelKey) return null;
  const wantedKind = billingKindForTaskKind(taskKind);
  const certificationRevisionId = trim(raw.comfyCertificationRevisionId);
  let model: Model;
  let stagedCandidate: ReturnType<typeof resolveComfyCandidateExecution> | undefined;
  try {
    if (certificationRevisionId) {
      const resolved = resolveComfyCandidateExecution({
        kind: taskKind,
        extras: {
          modelKey,
          comfyCertificationRevisionId: certificationRevisionId,
          certifyOutput: true,
        },
      });
      if (!resolved) return null;
      stagedCandidate = resolved;
      model = resolved.model;
    } else {
      model = findExecutableModel(vendorKey, modelKey, wantedKind).model;
    }
  } catch {
    return null; // 模型已不可用/未配置 → 无法重建，落回诚实诊断
  }
  const mapping = stagedCandidate?.mapping || findTaskMapping(vendorKey, taskKind, modelKey, modeId || undefined);
  if (!mapping?.query) return null; // 同步模型无 query op，没法续查
  const projectId = trim(raw.projectId) || activeTaskProjectFallback();
  return {
    vendor: vendorKey,
    request: {
      kind: taskKind,
      prompt: trim(raw.prompt),
      extras: {
        modelKey,
        ...(modeId ? { archetype: { modeId } } : {}),
        ...(certificationRevisionId ? { comfyCertificationRevisionId: certificationRevisionId, certifyOutput: true } : {}),
      },
    },
    raw: {},
    mapping,
    model,
    providerMeta: { task_id: taskId, query_id: taskId },
    ...(projectId ? { projectId } : {}),
    wantedKind,
  };
}

/**
 * 跑一次续查（缓存命中 / 无状态重建 共用单一真相）：有 query op 走 query；无则尝试 raw 里已带的
 * 资产；两条都不成立 → **诚实报失败**（这个任务根本查不了，不是「还没好」，见函数末尾）。
 */
async function executeTaskQuery(taskId: string, cached: CachedTask): Promise<{ vendor: string; result: TaskResult }> {
  const queryOperation = cached.mapping?.query;
  if (cached.mapping && queryOperation && cached.model) {
    // 不再用缓存的明文 key，轮询时按 vendor 重新派生（并重新校验 key 仍可用）。
    // ComfyUI certification intentionally keeps its candidate disabled until
    // this query has produced and decoded a real artifact. Resolve the exact
    // staged revision instead of treating that disabled model as unavailable.
    const stagedCandidate = resolveComfyCandidateExecution(cached.request);
    const { vendor, model, apiKey } = stagedCandidate || findExecutableModel(cached.vendor, cached.model.modelKey, cached.wantedKind);
    let executed = await executeProfileOperation({
      vendor,
      model,
      apiKey,
      request: cached.request,
      operation: queryOperation,
      stage: "query",
      providerMeta: {
        ...(cached.providerMeta || {}),
        query_id: cached.providerMeta?.query_id || taskId,
        task_id: cached.providerMeta?.task_id || taskId,
      },
    });
    let normalized = await buildProfileTaskResult({
      response: executed.response,
      mapping: cached.mapping,
      operation: queryOperation,
      request: cached.request,
      taskIdFallback: taskId,
      wantedKind: cached.wantedKind || model.kind,
      projectId: cached.projectId,
      nodeId: cached.nodeId,
      vendor,
      model,
    });
    if (normalized.result.status === "succeeded" && cached.mapping.result) {
      const resultProviderMeta = {
        ...(cached.providerMeta || {}),
        ...normalized.providerMeta,
        query_id: normalized.providerMeta.query_id || cached.providerMeta?.query_id || taskId,
        task_id: normalized.providerMeta.task_id || cached.providerMeta?.task_id || taskId,
      };
      executed = await executeProfileOperation({
        vendor,
        model,
        apiKey,
        request: cached.request,
        operation: cached.mapping.result,
        stage: "result",
        providerMeta: resultProviderMeta,
      });
      const resultNormalized = await buildProfileTaskResult({
        response: executed.response,
        mapping: cached.mapping,
        operation: cached.mapping.result,
        request: cached.request,
        taskIdFallback: taskId,
        wantedKind: cached.wantedKind || model.kind,
        projectId: cached.projectId,
        nodeId: cached.nodeId,
        vendor,
        model,
      });
      normalized = {
        ...resultNormalized,
        result: ensureAsyncMediaOutput(resultNormalized.result, cached.wantedKind || model.kind),
        providerMeta: { ...resultProviderMeta, ...resultNormalized.providerMeta },
      };
    }
    // 未知动词的有界容忍：连击够久 → 把「假装排队」翻成诚实的失败，并如实带上原始动词。
    const now = Date.now();
    const streak = advanceUnrecognizedStatusStreak(cached.unrecognizedStatusStreak, normalized.unrecognizedStatus, now);
    if (normalized.unrecognizedStatus) reportUnrecognizedStatus(cached, taskId, normalized.unrecognizedStatus);
    const result = unrecognizedStatusExhausted(streak, now)
      ? {
          ...normalized.result,
          status: "failed" as const,
          error: desktopT("tasks.unrecognizedStatus", {
            status: streak?.verb || "",
            polls: streak?.polls || 0,
            seconds: Math.round((now - (streak?.firstSeenAt || now)) / 1000),
          }),
        }
      : normalized.result;

    if (result.status === "succeeded" || result.status === "failed") {
      // 终态才入日志(轮询 tick 不记);cache.delete 保证单次触发
      traceVendorCompleted(cached.projectId, {
        runId: taskId,
        nodeId: cached.nodeId,
        status: result.status,
        assetCount: result.assets.length,
        ...(normalized.actualCost ? { cost: normalized.actualCost } : {}),
      });
      rememberTaskResult(cached.projectId || "", cached.fingerprint, result);
      taskCache.delete(taskId);
    } else {
      admitTask(taskId, {
        ...cached,
        raw: executed.response,
        providerMeta: {
          ...(cached.providerMeta || {}),
          ...normalized.providerMeta,
        },
        // 必须显式回写：认得的动词会让 streak 变 undefined，靠 ...cached 会把旧连击带回来。
        unrecognizedStatusStreak: streak,
      });
    }
    return { vendor: cached.vendor, result };
  }

  const assetUrl = extractAssetUrl(cached.raw);
  if (assetUrl) {
    const type: "image" | "video" | "audio" | "model3d" = cached.wantedKind === "video" ? "video" : cached.wantedKind === "audio" ? "audio" : cached.wantedKind === "model3d" ? "model3d" : "image";
    // vendor 提示必须带上：本地 ComfyUI 的产物 URL 是私网 /view，缺它 hardenedFetch 会按 SSRF 拒下载。
    const vendorHint = readCatalog().vendors.find((item) => item.key === cached.vendor);
    const asset = cached.projectId
      ? await localizeTaskAsset(cached.projectId, assetUrl, type, cached.nodeId, vendorHint)
      : unlocalizedTaskAsset(type, assetUrl);
    taskCache.delete(taskId);
    const lateResult: TaskResult = { id: taskId, kind: cached.request.kind, status: "succeeded", assets: [asset], raw: cached.raw };
    rememberTaskResult(cached.projectId || "", cached.fingerprint, lateResult);
    return { vendor: cached.vendor, result: lateResult };
  }

  // ── 「查不了」是**终态事实**，不是「还没好」（同一病根的第二条路径，见本文件顶部）──────────
  // 走到这里，两件事同时成立且此后都不会再变：
  //   ① 没有可发的 query —— 同步模型（如通用中转的图像 mapping：newapiTransport.ts:304 只给 create，
  //      catalogCommit.ts:222 因此不写 query 键）或无 mapping 的 fallback 提交（runtime.ts:505）。
  //      `cached.mapping` 是受理那刻的快照，不会自己长出 query op。
  //   ② create 响应里也没有产物。而 `cached.raw` **只在**上面那段 query 分支里被改写——对没有
  //      query op 的任务那段永不执行，raw 于是永远冻结在 create 那一刻。
  // 同样的输入喂给同一个 extractAssetUrl ⇒ 答案永远相同。fallback 那条路更绝：它正是在
  // extractAssetUrl 为空时才受理的（runtime.ts:502-506），这里注定再算一次同一个空值。
  // 此处过去返回 queued —— 而 queued 是**「再查一次」的指令**：渲染层于是一路空转到硬超时
  // （快道 2min / 视频 20min），最后报一句含糊的「可能仍在上游运行」，真因一次都没到过用户眼前。
  // 事实既然终态且**可知**，就如实报失败，并带上上游自己给的原因（中转的「no available channel」/
  // 余额不足就写在 create 响应体里，此前整条被丢掉）。
  // 注：`cached.model` 在所有受理点都必填（runtime.ts:445/506、本文件 165 的 `...cached`、重建），
  // 故落到这里的判据就是「无 query op」，文案如实这么说。
  const upstreamReason = taskFailureMessageFromResponse(cached.raw, cached.mapping?.create?.response_mapping ?? null);
  const unpollable: TaskResult = {
    id: taskId,
    kind: cached.request.kind,
    status: "failed",
    assets: [],
    raw: cached.raw,
    error:
      desktopT("tasks.noQueryOperation") +
      (upstreamReason ? desktopT("tasks.upstreamSaid", { detail: upstreamReason }) : ""),
  };
  const lateFailureCost = extractProviderCostActual(cached.vendor, cached.raw);
  traceVendorCompleted(cached.projectId, {
    runId: taskId,
    nodeId: cached.nodeId,
    status: "failed",
    assetCount: 0,
    ...(lateFailureCost ? { cost: lateFailureCost } : {}),
  });
  // 与其它终态一致地清缓存；额外好处：用户之后「重新拉取」会走无状态重建，那条路**重读 catalog**，
  // 模型若后来补上了 query op 就真能查出来（留着旧快照反而钉死在「永远查不了」）。
  taskCache.delete(taskId);
  return { vendor: cached.vendor, result: unpollable };
}

/** 提交时 projectId 空窗会毒化整个任务生命周期（cached.projectId 恒空 → 每次轮询都跳过本地化、
 *  终态只存易失 CDN url）。轮询 payload 带的 projectId / 主进程活动项目给它第二次机会。 */
function withProjectIdSecondChance(cached: CachedTask, pollProjectId: string): CachedTask {
  if (cached.projectId) return cached;
  const projectId = pollProjectId || activeTaskProjectFallback();
  return projectId ? { ...cached, projectId } : cached;
}

export async function fetchTaskResult(payload: unknown): Promise<{ vendor: string; result: TaskResult }> {
  const raw = payload as JsonRecord;
  const taskId = trim(raw.taskId);
  const cached = taskCache.get(taskId);
  if (cached) return executeTaskQuery(taskId, withProjectIdSecondChance(cached, trim(raw.projectId)));

  // 缓存 miss：先试无状态重建（重启/驱逐后仍能续查的治本点）。重建得了就走同一段 query。
  const rebuilt = rebuildCachedTaskFromPayload(taskId, raw);
  if (rebuilt) {
    // Never turn a real provider/retrieval error into task_tracking_lost. The
    // renderer treats a thrown query error as recoverable and can retry it for
    // free; converting it to a terminal cache-miss result made a valid task
    // unrecoverable after restart (especially when localization hit a transient
    // CDN/proxy failure). Only an actually unreconstructable task reaches the
    // cache-miss classifier below.
    return executeTaskQuery(taskId, rebuilt);
  }

  // 区分两种 miss：曾受理但被驱逐/过期(可能 vendor 侧已完成) vs 真·未知 id（修 P1）。
  const miss = classifyTaskCacheMiss(taskId, wasTaskAdmitted(taskId));
  return {
    vendor: trim(raw.vendor),
    result: {
      id: taskId,
      kind: (raw.taskKind as ProfileKind) || "text_to_image",
      status: miss.status,
      assets: [],
      raw: miss.raw,
      error: miss.error,
    },
  };
}
