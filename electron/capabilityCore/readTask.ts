/**
 * `nomi_read target=task`：按任务号查一个已提交异步任务**现在**的状态。
 *
 * 为什么存在：`nomi_try_model` 等不到终态会返回 `still_processing` 加任务号，并说「已收费、不要重试」。
 * 此前 AI 手里没有任何工具能按任务号看结果，只能叫用户去供应商后台。
 *
 * 只读、不花钱、不重提交：只走 `fetchTaskResult`（与画布 / 试跑同一条查询链路，`pollTaskToTerminal`
 * 调的也是它），**不碰 `runTask`**——这个模块里没有任何提交入口，所以结构上不可能再收一次费。
 * 只查一次、不循环：它是一次 MCP 工具调用，外部宿主有工具超时（例如 Codex 默认 60 秒）。
 */
import type { FetchTaskResultFn } from "./core";
import { TtlLruCache } from "../tasks/taskCache";
import { isTaskCacheMissRaw } from "../tasks/taskAdmission";
import { isTerminalTaskStatus } from "../shared/taskStatus";
import { redactAdapterSecrets, sanitizedAdapterJson } from "../providerAdapter/redaction";

/** 单次查询的上限：留足余量给宿主的 60 秒工具超时。 */
export const READ_TASK_QUERY_BUDGET_MS = 20_000;

export type ReadTaskState = "queued" | "processing" | "succeeded" | "failed" | "unknown_task" | "not_tracked" | "query_failed";

export type ReadTaskResult = {
  taskId: string;
  state: ReadTaskState;
  /** `succeeded` 时的产物。 */
  assets?: Array<{ type: string; url: string }>;
  /** `failed` 时供应商的原话（脱敏）。 */
  providerMessage?: string;
  evidence?: { bodyExcerpt: string };
  message: string;
  nextAction: string;
};

/**
 * 终态结果的短期备忘：`fetchTaskResult` 在终态时会把任务从工作缓存里清掉（正常，生成方拿到结果就够了），
 * 于是 AI 第二次再问同一个号会被说成「Nomi 不再跟踪」——对一个已经查到结果的任务那是假话。
 * 这里只记「刚查到的终态」，让重复查询一致；不是第二套任务状态（不提交、不轮询）。
 */
const terminalMemo = new TtlLruCache<ReadTaskResult>({ maxEntries: 100, ttlMs: 60 * 60 * 1000 });

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("read_task_query_budget_exhausted")), ms); }),
  ]).finally(() => clearTimeout(timer));
};

export async function readTask(
  deps: { fetchTaskResult?: FetchTaskResultFn; queryBudgetMs?: number },
  args: Record<string, unknown>,
): Promise<ReadTaskResult> {
  const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
  const remembered = terminalMemo.get(taskId);
  if (remembered) return remembered;
  if (!deps.fetchTaskResult) {
    return {
      taskId, state: "query_failed",
      message: "This Nomi host cannot query tasks right now. Nothing was submitted and nothing was charged by this read.",
      nextAction: "Ask the user to check the job in the provider's own console using this task id. Do not call nomi_try_model again for it.",
    };
  }
  let result;
  try {
    ({ result } = await withTimeout(deps.fetchTaskResult({ taskId, vendor: "", taskKind: "", prompt: "", modelKey: "" }), deps.queryBudgetMs ?? READ_TASK_QUERY_BUDGET_MS));
  } catch (error) {
    return {
      taskId, state: "query_failed",
      message: `Could not reach the provider just now (${redactAdapterSecrets(error instanceof Error ? error.message : String(error), 200)}). The job itself is not affected, and this read submitted nothing.`,
      nextAction: "Wait a little and read this task again. Do not submit the generation again: that would charge a second job.",
    };
  }
  if (isTaskCacheMissRaw(result.raw)) {
    const tracked = result.raw.code === "task_tracking_lost";
    return tracked
      ? {
          taskId, state: "not_tracked",
          message: "Nomi is no longer tracking this task (it restarted, or the entry expired, or another screen in Nomi already took its result). The provider may well have finished it; Nomi just cannot see that any more. The charge, if any, was already made.",
          nextAction: "Do NOT submit it again. Tell the user to look the task id up in the provider's own console (or in the project's assets, if it was a canvas generation). Submitting a new generation is a new charge and only for the user to decide.",
        }
      : {
          taskId, state: "unknown_task",
          message: "Nomi does not recognize this task id. That is not a failed generation. Either the id is mistyped, or Nomi has been restarted since the task was submitted: Nomi keeps its task list in memory only, so after a restart it is no longer tracking any earlier task. If it was real, the provider still has it and the charge was already made.",
          nextAction: "Check the id exactly as nomi_try_model returned it. If it is right, do NOT submit it again; tell the user Nomi can no longer follow this task and to look the id up in the provider's own console. A new generation is a new charge and only for the user to decide.",
        };
  }
  if (isTerminalTaskStatus(result.status)) {
    const assets = Array.isArray(result.assets) ? result.assets.map((asset) => ({ type: String(asset.type), url: String(asset.url) })) : [];
    const done: ReadTaskResult = result.status === "succeeded" && assets.length > 0
      ? {
          taskId, state: "succeeded", assets,
          message: "The provider finished this task and produced an artifact.",
          nextAction: "Report the result to the user. The model is usable in Nomi's model pickers; nothing more to submit.",
        }
      : {
          taskId, state: "failed",
          providerMessage: redactAdapterSecrets(result.error || `status=${result.status}`, 300),
          evidence: { bodyExcerpt: sanitizedAdapterJson(result.raw).slice(0, 512) },
          message: `The provider reports this task did not produce anything${result.error ? `: ${redactAdapterSecrets(result.error, 300)}` : ""}.`,
          nextAction: "The provider's own words are in providerMessage. Fix what it points at (the card or the prompt) and, only if the user agrees to another charge, run nomi_try_model once more.",
        };
    terminalMemo.set(taskId, done);
    return done;
  }
  return {
    taskId,
    state: result.status === "queued" ? "queued" : "processing",
    message: `The task is still ${result.status === "queued" ? "queued" : "processing"} at the provider. It was already charged when it was submitted. This is NOT a failure.`,
    nextAction: "Read this task again in a minute or so. Do NOT call nomi_try_model again: that would submit and charge a second job.",
  };
}
